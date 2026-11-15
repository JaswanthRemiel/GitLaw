import { Octokit } from '@octokit/rest';
import { PRReviewSummary, RuleViolation } from '../types/index.js';

export class GitHubReviewPublisher {
  constructor(private octokit: Octokit) {}

  public async publishReview(
    options: {
      owner: string;
      repo: string;
      pullNumber: number;
      commitId: string;
      reviewSummary: PRReviewSummary;
      asCheckRun?: boolean;
    }
  ): Promise<{ reviewId?: number; checkRunId?: number }> {
    const { owner, repo, pullNumber, commitId, reviewSummary } = options;

    // Prepare inline comments anchored to file and line numbers
    const comments: Array<{
      path: string;
      line: number;
      side: 'RIGHT';
      body: string;
    }> = [];

    for (const v of reviewSummary.violations) {
      if (v.line && v.file) {
        comments.push({
          path: v.file,
          line: v.line,
          side: 'RIGHT',
          body: this.formatInlineCommentBody(v),
        });
      }
    }

    console.log(
      `[GitLaw Publisher] Submitting GitHub Review on ${owner}/${repo}#${pullNumber} with ${comments.length} inline comments...`
    );

    let reviewId: number | undefined;

    try {
      const reviewRes = await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitId,
        event: reviewSummary.decision,
        body: reviewSummary.summaryComment,
        comments,
      });
      reviewId = reviewRes.data.id;
      console.log(`[GitLaw Publisher] Review submitted successfully (ID: ${reviewId}).`);
    } catch (err: any) {
      console.warn(`[GitLaw Publisher] Warning: createReview failed, falling back to standalone PR comment:`, err.message);

      // Fallback: post the summary as an issue comment if createReview was rejected (e.g. invalid commitId or permissions)
      const commentRes = await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: reviewSummary.summaryComment,
      });
      reviewId = commentRes.data.id;
    }

    // Optionally publish GitHub Check Run
    let checkRunId: number | undefined;
    if (options.asCheckRun) {
      try {
        const conclusion = reviewSummary.decision === 'REQUEST_CHANGES' ? 'failure' : 'success';
        const checkRes = await this.octokit.checks.create({
          owner,
          repo,
          name: 'GitLaw / Team Conventions',
          head_sha: commitId,
          status: 'completed',
          conclusion,
          output: {
            title: `GitLaw: ${reviewSummary.violations.length} Convention Violations Flagged`,
            summary: reviewSummary.summaryComment,
            annotations: reviewSummary.violations.slice(0, 50).map(v => ({
              path: v.file,
              start_line: v.line,
              end_line: v.line,
              annotation_level: v.severity === 'error' ? 'failure' : 'warning',
              message: v.message,
              title: v.ruleTitle,
            })),
          },
        });
        checkRunId = checkRes.data.id;
      } catch (err) {
        console.warn(`[GitLaw Publisher] Check run creation skipped or not permitted:`, err);
      }
    }

    return { reviewId, checkRunId };
  }

  private formatInlineCommentBody(v: RuleViolation): string {
    const icon = v.severity === 'error' ? '🔴' : v.severity === 'warning' ? '🟡' : 'ℹ️';
    let body = `⚖️ **GitLaw Convention Violation:** ${icon} **${v.ruleTitle}** (${(v.confidence * 100).toFixed(0)}% confidence)\n\n`;
    body += `${v.message}\n\n`;

    if (v.citations.length > 0) {
      const c = v.citations[0];
      body += `> 💡 **Team Convention Evidence (PR #${c.prNumber}${c.author ? ` by @${c.author}` : ''}):**\n`;
      if (c.commentQuote) {
        body += `> *"${c.commentQuote.replace(/\n/g, ' ').slice(0, 150)}..."*\n\n`;
      }
    }

    if (v.suggestedFix) {
      body += `\`\`\`suggestion\n${v.suggestedFix}\n\`\`\`\n`;
    }

    return body;
  }
}
