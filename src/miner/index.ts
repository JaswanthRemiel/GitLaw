import { Octokit } from '@octokit/rest';
import { ILLMProvider, MinedPRComment, MiningStats, Rule } from '../types/index.js';
import { RuleDatabase } from '../db/database.js';
import { ReviewCommentNoiseFilter } from './noise-filter.js';
import { ConventionExtractor } from './extractor.js';
import { RuleSynthesizer } from './synthesizer.js';

export interface MineRepoOptions {
  owner: string;
  repo: string;
  prLimit?: number;
  sinceDate?: string;
  batchSize?: number;
}

export class ConventionMiner {
  private extractor: ConventionExtractor;
  private synthesizer: RuleSynthesizer;

  constructor(
    private octokit: Octokit,
    private db: RuleDatabase,
    private llm: ILLMProvider
  ) {
    this.extractor = new ConventionExtractor(this.llm);
    this.synthesizer = new RuleSynthesizer(this.db, this.llm);
  }

  public async mineRepository(options: MineRepoOptions): Promise<{ stats: MiningStats; rules: Rule[] }> {
    const startTime = Date.now();
    const prLimit = options.prLimit ?? 30;
    const batchSize = options.batchSize ?? 10;
    const repoIdentifier = `${options.owner}/${options.repo}`;

    const stats: MiningStats = {
      scannedPRs: 0,
      scannedComments: 0,
      filteredNoiseComments: 0,
      extractedRawRules: 0,
      synthesizedRulesCount: 0,
      durationMs: 0,
    };

    console.log(`[GitLaw Miner] Scanning past PRs in ${repoIdentifier} (limit: ${prLimit})...`);

    // Fetch closed / merged PRs
    const prsResponse = await this.octokit.pulls.list({
      owner: options.owner,
      repo: options.repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: Math.min(prLimit, 100),
    });

    const prs = prsResponse.data;
    stats.scannedPRs = prs.length;

    const usefulComments: MinedPRComment[] = [];

    for (const pr of prs) {
      // Fetch review comments for this PR
      try {
        const commentsResponse = await this.octokit.pulls.listReviewComments({
          owner: options.owner,
          repo: options.repo,
          pull_number: pr.number,
          per_page: 100,
        });

        for (const c of commentsResponse.data) {
          stats.scannedComments++;

          // Check if already processed
          if (this.db.hasCommentBeenProcessed(c.id)) {
            continue;
          }

          const minedComment: MinedPRComment = {
            id: c.id,
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.html_url,
            author: c.user ? c.user.login : 'unknown',
            path: c.path,
            diffHunk: c.diff_hunk,
            body: c.body,
            inReplyToId: c.in_reply_to_id,
            createdAt: c.created_at,
          };

          if (ReviewCommentNoiseFilter.isUsefulComment(minedComment)) {
            usefulComments.push(minedComment);
          } else {
            stats.filteredNoiseComments++;
          }

          this.db.markCommentProcessed(c.id, pr.number, repoIdentifier, minedComment.author);
        }
      } catch (err) {
        console.warn(`[GitLaw Miner] Warning: could not fetch comments for PR #${pr.number}:`, err);
      }
    }

    console.log(
      `[GitLaw Miner] Collected ${usefulComments.length} high-signal convention comments (filtered ${stats.filteredNoiseComments} noise/trivial comments).`
    );

    const allSynthesizedRules: Rule[] = [];

    // Process in batches with LLM
    for (let i = 0; i < usefulComments.length; i += batchSize) {
      const batch = usefulComments.slice(i, i + batchSize);
      console.log(`[GitLaw Miner] Extracting conventions from batch ${Math.floor(i / batchSize) + 1}...`);

      const rawCandidates = await this.extractor.extractRulesFromComments(batch);
      stats.extractedRawRules += rawCandidates.length;

      if (rawCandidates.length > 0) {
        const synthesized = await this.synthesizer.synthesizeAndPersist(rawCandidates, batch);
        allSynthesizedRules.push(...synthesized);
      }
    }

    stats.synthesizedRulesCount = allSynthesizedRules.length;
    stats.durationMs = Date.now() - startTime;

    console.log(
      `[GitLaw Miner] Mining completed in ${(stats.durationMs / 1000).toFixed(1)}s. Discovered ${allSynthesizedRules.length} team conventions.`
    );

    return { stats, rules: allSynthesizedRules };
  }
}
