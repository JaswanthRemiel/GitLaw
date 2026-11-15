import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GitDiffParser } from '../src/reviewer/diff-parser';
import { RuleDatabase } from '../src/db/database';
import { PRReviewEngine } from '../src/reviewer';
import { MockLLMProvider } from '../src/llm/mock';
import { Rule } from '../src/types';

describe('PRReviewEngine & GitDiffParser', () => {
  const sampleDiff = `diff --git a/src/services/user.service.ts b/src/services/user.service.ts
index 1234567..89abcdef 100644
--- a/src/services/user.service.ts
+++ b/src/services/user.service.ts
@@ -40,4 +40,5 @@ export class UserService {
   async getUser(id: string) {
     const user = await this.repo.findById(id);
+    if (!user) throw new Error("User not found");
     return user;
   }
`;

  it('parses unified git diff correctly and records line numbers', () => {
    const hunks = GitDiffParser.parseUnifiedDiff(sampleDiff);
    expect(hunks.length).toBe(1);
    expect(hunks[0].file).toBe('src/services/user.service.ts');
    expect(hunks[0].addedLines.length).toBe(1);
    expect(hunks[0].addedLines[0].line).toBe(42);
    expect(hunks[0].addedLines[0].text).toContain('throw new Error');
  });

  const testDbDir = path.join(process.cwd(), '.gitlaw_test_rev');
  const testDbPath = path.join(testDbDir, 'rules.sqlite');
  let db: RuleDatabase;

  beforeEach(() => {
    if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
    db = new RuleDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  it('audits diff against team conventions and flags violations with citations', async () => {
    const mockRule: Rule = {
      id: 'use-result-type-for-errors',
      title: 'Use Result/Either type instead of throwing raw exceptions in domain services',
      category: 'error-handling',
      description: 'Domain services must return Result rather than throwing raw Error.',
      guidelines: ['Do not throw Error in service methods'],
      positiveExamples: ['return Result.fail(new NotFoundError())'],
      negativeExamples: ['throw new Error("fail")'],
      applicableGlobs: ['**/*.service.ts'],
      severity: 'error',
      confidence: 0.95,
      occurrenceCount: 2,
      evidence: [
        {
          prNumber: 104,
          commentId: 55,
          author: 'tech-lead',
          commentBody: 'Please do not throw raw Error here; return Result.fail so caller is forced to handle it.',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const mockLlm = new MockLLMProvider();
    const vec = await mockLlm.embed(mockRule.title + ' ' + mockRule.description);
    db.saveRule(mockRule, vec);

    const reviewer = new PRReviewEngine({} as any, db, mockLlm);

    const reviewSummary = await reviewer.reviewPullRequest({
      owner: 'acme',
      repo: 'backend',
      pullNumber: 205,
      rawDiff: sampleDiff,
    });

    expect(reviewSummary.analyzedFiles).toBe(1);
    expect(reviewSummary.violations.length).toBe(1);
    expect(reviewSummary.decision).toBe('REQUEST_CHANGES');

    const v = reviewSummary.violations[0];
    expect(v.ruleId).toBe('use-result-type-for-errors');
    expect(v.line).toBe(42);
    expect(v.citations.length).toBeGreaterThan(0);
    expect(v.citations[0].prNumber).toBe(104);

    expect(reviewSummary.summaryComment).toContain('GitLaw Review: Team Convention Audit');
    expect(reviewSummary.summaryComment).toContain('Use Result/Either type');
    expect(reviewSummary.summaryComment).toContain('PR #104');
  });
});
