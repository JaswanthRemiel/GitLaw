import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RuleDatabase } from '../src/db/database';
import { RuleSynthesizer } from '../src/miner/synthesizer';
import { MockLLMProvider } from '../src/llm/mock';
import { ExtractedRuleCandidate } from '../src/miner/extractor';
import { MinedPRComment } from '../src/types';

describe('RuleSynthesizer', () => {
  const testDbDir = path.join(process.cwd(), '.gitlaw_test_synth');
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

  it('synthesizes new rules and merges repeated conventions with confidence boost', async () => {
    const mockLlm = new MockLLMProvider();
    const synthesizer = new RuleSynthesizer(db, mockLlm);

    const comment1: MinedPRComment = {
      id: 201,
      prNumber: 50,
      prTitle: 'Add Auth',
      prUrl: 'https://github.com/org/repo/pull/50',
      author: 'lead-dev',
      path: 'src/services/auth.service.ts',
      diffHunk: '@@ -10,2 +10,2 @@',
      body: 'Please do not throw raw Error here; return Result.fail',
      createdAt: '2026-01-01T00:00:00Z',
    };

    const candidate1: ExtractedRuleCandidate = {
      title: 'Use Result/Either type instead of throwing raw exceptions in domain services',
      category: 'error-handling',
      description: 'Domain services must return Result rather than throwing raw Error.',
      guidelines: ['Do not throw Error in service methods'],
      positiveExamples: ['return Result.fail(new NotFoundError())'],
      negativeExamples: ['throw new Error("fail")'],
      applicableGlobs: ['**/*.service.ts'],
      severity: 'error',
      confidence: 0.85,
      sourceCommentId: 201,
    };

    const rulesPass1 = await synthesizer.synthesizeAndPersist([candidate1], [comment1]);
    expect(rulesPass1.length).toBe(1);
    expect(db.getAllRules().length).toBe(1);

    const firstRule = db.getAllRules()[0];
    expect(firstRule.occurrenceCount).toBe(1);
    expect(firstRule.confidence).toBe(0.85);

    // Now simulate second PR review comment reinforcing the same convention
    const comment2: MinedPRComment = {
      id: 202,
      prNumber: 75,
      prTitle: 'Payment Service',
      prUrl: 'https://github.com/org/repo/pull/75',
      author: 'senior-dev',
      path: 'src/services/payment.service.ts',
      diffHunk: '@@ -25,2 +25,2 @@',
      body: 'Remember our rule: return Result.fail instead of throwing exceptions in services',
      createdAt: '2026-01-05T00:00:00Z',
    };

    const candidate2: ExtractedRuleCandidate = {
      title: 'Use Result/Either type instead of throwing raw exceptions in domain services',
      category: 'error-handling',
      description: 'Domain services must return Result rather than throwing raw Error.',
      guidelines: ['Always handle errors explicitly at controller boundaries'],
      positiveExamples: ['return Result.ok(payment)'],
      negativeExamples: ['throw new PaymentError("declined")'],
      applicableGlobs: ['**/*.service.ts'],
      severity: 'error',
      confidence: 0.88,
      sourceCommentId: 202,
    };

    const rulesPass2 = await synthesizer.synthesizeAndPersist([candidate2], [comment2]);
    expect(rulesPass2.length).toBe(1);
    expect(db.getAllRules().length).toBe(1); // Deduped, merged into 1 rule

    const mergedRule = db.getAllRules()[0];
    expect(mergedRule.occurrenceCount).toBe(2);
    expect(mergedRule.confidence).toBeGreaterThan(0.85); // Boosted confidence!
    expect(mergedRule.evidence.length).toBe(2); // Retained citations from both PR #50 and PR #75
    expect(mergedRule.guidelines).toContain('Always handle errors explicitly at controller boundaries');
  });
});
