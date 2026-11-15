import { Probot } from 'probot';
import { RuleDatabase } from '../db/database.js';
import { createLLMProvider } from '../llm/factory.js';
import { PRReviewEngine } from '../reviewer/index.js';
import { GitHubReviewPublisher } from './publisher.js';
import { ConventionMiner } from '../miner/index.js';
import { ReviewCommentNoiseFilter } from '../miner/noise-filter.js';
import { ConventionExtractor } from '../miner/extractor.js';
import { RuleSynthesizer } from '../miner/synthesizer.js';

export function gitlawApp(app: Probot): void {
  const db = new RuleDatabase();
  const llm = createLLMProvider();
  const extractor = new ConventionExtractor(llm);
  const synthesizer = new RuleSynthesizer(db, llm);

  app.log.info('GitLaw GitHub App loaded and listening for PR events.');

  // 1. Audit PR on opened and synchronize (new commits pushed)
  app.on(['pull_request.opened', 'pull_request.synchronize'], async (context) => {
    const { owner, repo } = context.repo();
    const prNumber = context.payload.pull_request.number;
    const commitId = context.payload.pull_request.head.sha;

    app.log.info(`[GitLaw Webhook] PR #${prNumber} triggered in ${owner}/${repo}`);

    const octokitAny = (context.octokit as any).rest || context.octokit;
    const reviewer = new PRReviewEngine(octokitAny, db, llm);
    const publisher = new GitHubReviewPublisher(octokitAny);

    try {
      const summary = await reviewer.reviewPullRequest({
        owner,
        repo,
        pullNumber: prNumber,
        commitId,
      });

      await publisher.publishReview({
        owner,
        repo,
        pullNumber: prNumber,
        commitId,
        reviewSummary: summary,
        asCheckRun: true,
      });
    } catch (err) {
      app.log.error(err as Error, `[GitLaw Webhook] Error reviewing PR #${prNumber}`);
    }
  });

  // 2. Incremental Learning: Learn from new human review comments in real-time
  app.on('pull_request_review_comment.created', async (context) => {
    const comment = context.payload.comment;
    const pr = context.payload.pull_request;
    const { owner, repo } = context.repo();
    const repoIdentifier = `${owner}/${repo}`;

    const authorLogin = comment.user?.login || 'unknown';
    const authorType = comment.user?.type;

    // Avoid self-learning from GitLaw bot comments
    if (authorLogin.includes('gitlaw') || authorType === 'Bot') {
      return;
    }

    const minedComment = {
      id: comment.id,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
      author: authorLogin,
      path: comment.path,
      diffHunk: comment.diff_hunk,
      body: comment.body,
      createdAt: comment.created_at,
    };

    if (ReviewCommentNoiseFilter.isUsefulComment(minedComment)) {
      app.log.info(`[GitLaw Continuous Learner] Learning convention from comment #${comment.id} on PR #${pr.number}...`);
      db.markCommentProcessed(comment.id, pr.number, repoIdentifier, authorLogin);

      try {
        const candidates = await extractor.extractRulesFromComments([minedComment]);
        if (candidates.length > 0) {
          const synthesized = await synthesizer.synthesizeAndPersist(candidates, [minedComment]);
          app.log.info(
            `[GitLaw Continuous Learner] Learned/reinforced ${synthesized.length} convention(s): ${synthesized
              .map(r => r.title)
              .join('; ')}`
          );
        }
      } catch (err) {
        app.log.error(err as Error, '[GitLaw Continuous Learner] Error learning from comment');
      }
    }
  });

  // 3. PR Comment Commands (/gitlaw review, /gitlaw learn, /gitlaw rules)
  app.on('issue_comment.created', async (context) => {
    const commentBody = context.payload.comment.body.trim();
    if (!commentBody.startsWith('/gitlaw')) return;

    const { owner, repo } = context.repo();
    const issueNumber = context.payload.issue.number;
    const isPR = Boolean(context.payload.issue.pull_request);
    const octokitAny = (context.octokit as any).rest || context.octokit;

    if (!isPR) {
      await octokitAny.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: '⚖️ GitLaw operates on Pull Requests. Please run commands in a Pull Request thread.',
      });
      return;
    }

    const command = commentBody.split(/\s+/)[1] || 'help';

    if (command === 'review') {
      await octokitAny.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: '⚖️ GitLaw starting manual PR convention review...',
      });

      const prData = await octokitAny.pulls.get({
        owner,
        repo,
        pull_number: issueNumber,
      });

      const reviewer = new PRReviewEngine(octokitAny, db, llm);
      const publisher = new GitHubReviewPublisher(octokitAny);

      const summary = await reviewer.reviewPullRequest({
        owner,
        repo,
        pullNumber: issueNumber,
        commitId: prData.data.head.sha,
      });

      await publisher.publishReview({
        owner,
        repo,
        pullNumber: issueNumber,
        commitId: prData.data.head.sha,
        reviewSummary: summary,
      });
    } else if (command === 'learn') {
      await octokitAny.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: '⚖️ GitLaw is mining past PR comments to learn team conventions. This may take a minute...',
      });

      const miner = new ConventionMiner(octokitAny, db, llm);
      const result = await miner.mineRepository({
        owner,
        repo,
        prLimit: 50,
      });

      await octokitAny.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `### ⚖️ GitLaw Mining Complete!
- **Scanned PRs:** ${result.stats.scannedPRs}
- **Scanned Comments:** ${result.stats.scannedComments}
- **Learned/Reinforced Conventions:** ${result.rules.length}
- **Total Conventions Active:** ${db.getAllRules().length}

Run \`/gitlaw rules\` to see all active team conventions.`,
      });
    } else if (command === 'rules') {
      const rules = db.getAllRules();
      if (rules.length === 0) {
        await octokitAny.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: '⚖️ No conventions learned yet. Run `/gitlaw learn` to mine past PRs.',
        });
        return;
      }

      let reply = `### ⚖️ Active Team Conventions (${rules.length})\n\n`;
      for (const r of rules.slice(0, 15)) {
        reply += `- **[${r.category.toUpperCase()}] ${r.title}** (Confidence: ${(r.confidence * 100).toFixed(0)}%, ${r.occurrenceCount} occurrences)\n`;
      }
      if (rules.length > 15) {
        reply += `\n*...and ${rules.length - 15} more.*`;
      }

      await octokitAny.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: reply,
      });
    } else {
      await octokitAny.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `### ⚖️ GitLaw Commands
- \`/gitlaw review\` - Run an immediate convention audit on this PR.
- \`/gitlaw learn\` - Mine past closed PRs to extract and strengthen team conventions.
- \`/gitlaw rules\` - List all currently learned team conventions.
- \`/gitlaw help\` - Show this help message.`,
      });
    }
  });
}
