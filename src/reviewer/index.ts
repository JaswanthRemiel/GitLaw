import { Octokit } from '@octokit/rest';
import { ILLMProvider, PRReviewSummary, RuleViolation } from '../types/index.js';
import { RuleDatabase } from '../db/database.js';
import { GitDiffParser } from './diff-parser.js';
import { RuleMatcher } from './matcher.js';
import { PRViolationAnalyzer } from './analyzer.js';

export interface ReviewPullRequestOptions {
  owner: string;
  repo: string;
  pullNumber: number;
  commitId?: string;
  rawDiff?: string;
}

export class PRReviewEngine {
  private matcher: RuleMatcher;
  private analyzer: PRViolationAnalyzer;

  constructor(
    private octokit: Octokit,
    private db: RuleDatabase,
    private llm: ILLMProvider
  ) {
    this.matcher = new RuleMatcher(this.db, this.llm);
    this.analyzer = new PRViolationAnalyzer(this.llm);
  }

  public async reviewPullRequest(options: ReviewPullRequestOptions): Promise<PRReviewSummary> {
    const startTime = Date.now();
    const repoIdentifier = `${options.owner}/${options.repo}`;

    let diffText = options.rawDiff;
    if (!diffText) {
      console.log(`[GitLaw Reviewer] Fetching diff for PR #${options.pullNumber} in ${repoIdentifier}...`);
      const diffResponse = await this.octokit.pulls.get({
        owner: options.owner,
        repo: options.repo,
        pull_number: options.pullNumber,
        mediaType: {
          format: 'diff',
        },
      });
      diffText = diffResponse.data as unknown as string;
    }

    const hunks = GitDiffParser.parseUnifiedDiff(diffText || '');
    const uniqueFiles = new Set(hunks.map(h => h.file));

    console.log(`[GitLaw Reviewer] Parsed ${hunks.length} hunks across ${uniqueFiles.size} modified files.`);

    const matchedHunks = await this.matcher.findCandidateRulesForHunks(hunks);
    const totalMatchedRules = new Set(matchedHunks.flatMap(m => m.rules.map(r => r.id))).size;

    console.log(`[GitLaw Reviewer] Matched ${totalMatchedRules} relevant team conventions. Running violation audit...`);

    const violations = await this.analyzer.analyzeHunks(matchedHunks);

    console.log(`[GitLaw Reviewer] Audit finished. Detected ${violations.length} convention violations.`);

    // Determine decision
    const hasErrorViolations = violations.some(v => v.severity === 'error' && v.confidence >= 0.85);
    const decision: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' = violations.length === 0
      ? 'APPROVE'
      : hasErrorViolations
      ? 'REQUEST_CHANGES'
      : 'COMMENT';

    const summaryComment = this.generateSummaryComment({
      prNumber: options.pullNumber,
      repository: repoIdentifier,
      analyzedFiles: uniqueFiles.size,
      analyzedHunks: hunks.length,
      matchedRules: totalMatchedRules,
      violations,
      decision,
      reviewDurationMs: Date.now() - startTime,
    });

    const summary: PRReviewSummary = {
      prNumber: options.pullNumber,
      repository: repoIdentifier,
      analyzedFiles: uniqueFiles.size,
      analyzedHunks: hunks.length,
      matchedRules: totalMatchedRules,
      violations,
      decision,
      summaryComment,
      reviewDurationMs: Date.now() - startTime,
    };

    // Save review record to DB
    this.db.recordReview(summary);

    return summary;
  }

  private generateSummaryComment(data: {
    prNumber: number;
    repository: string;
    analyzedFiles: number;
    analyzedHunks: number;
    matchedRules: number;
    violations: RuleViolation[];
    decision: string;
    reviewDurationMs: number;
  }): string {
    const duration = (data.reviewDurationMs / 1000).toFixed(1);

    if (data.violations.length === 0) {
      return `### ⚖️ GitLaw Review: Clean Bill of Health!
All **${data.analyzedFiles} modified files** adhere to your team's learned conventions (${data.matchedRules} rules audited in ${duration}s).

No unwritten rule violations detected. Great job!`;
    }

    let comment = `### ⚖️ GitLaw Review: Team Convention Audit\n\n`;
    comment += `GitLaw audited **${data.analyzedFiles} files** against **${data.matchedRules} learned team conventions** in ${duration}s.\n\n`;

    const errorCount = data.violations.filter(v => v.severity === 'error').length;
    const warnCount = data.violations.filter(v => v.severity === 'warning').length;
    const infoCount = data.violations.filter(v => v.severity === 'info').length;

    comment += `| 🔴 Errors | 🟡 Warnings | ℹ️ Suggestions | Status |\n`;
    comment += `| :---: | :---: | :---: | :---: |\n`;
    comment += `| **${errorCount}** | **${warnCount}** | **${infoCount}** | **${data.decision}** |\n\n`;

    comment += `#### Flagged Violations\n\n`;

    for (let i = 0; i < data.violations.length; i++) {
      const v = data.violations[i];
      const icon = v.severity === 'error' ? '🔴' : v.severity === 'warning' ? '🟡' : 'ℹ️';

      comment += `**${i + 1}. ${icon} [${v.category.toUpperCase()}] ${v.ruleTitle}**\n`;
      comment += `- **File:** \`${v.file}:${v.line}\` (Confidence: ${(v.confidence * 100).toFixed(0)}%)\n`;
      comment += `- **Violation:** ${v.message}\n`;

      if (v.citations.length > 0) {
        const topCitation = v.citations[0];
        comment += `- **Team Evidence:** In PR #${topCitation.prNumber}${
          topCitation.author ? ` by @${topCitation.author}` : ''
        }: *"${topCitation.commentQuote ? topCitation.commentQuote.replace(/\n/g, ' ').slice(0, 100) : ''}..."*\n`;
      }

      if (v.suggestedFix) {
        comment += `\n\`\`\`suggestion\n${v.suggestedFix}\n\`\`\`\n`;
      }
      comment += `\n`;
    }

    comment += `---\n*GitLaw learns conventions by mining past PR reviews. Run \`/gitlaw learn\` to refresh rules.*`;

    return comment;
  }
}
