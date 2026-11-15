import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RuleDatabase } from '../src/db/database';
import { Rule } from '../src/types';
import { LocalVectorEmbedder } from '../src/llm/embedder';

describe('RuleDatabase', () => {
  const testDbDir = path.join(process.cwd(), '.gitlaw_test');
  const testDbPath = path.join(testDbDir, 'test_rules.sqlite');
  let db: RuleDatabase;
  const embedder = new LocalVectorEmbedder(64);

  beforeEach(() => {
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
    db = new RuleDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  });

  it('saves and retrieves rules with vector search and glob filtering', () => {
    const rule1: Rule = {
      id: 'prefer-result-type',
      title: 'Prefer Result type over throwing raw exceptions in services',
      category: 'error-handling',
      description: 'Domain services must not throw unhandled exceptions.',
      guidelines: ['Use Result.ok and Result.fail'],
      positiveExamples: ['return Result.ok(data);'],
      negativeExamples: ['throw new Error("fail");'],
      applicableGlobs: ['**/*.service.ts'],
      severity: 'error',
      confidence: 0.9,
      occurrenceCount: 3,
      evidence: [
        {
          prNumber: 42,
          commentId: 101,
          author: 'alice',
          commentBody: 'Please return Result.fail instead of throwing',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const vec1 = embedder.embed(rule1.title + ' ' + rule1.description);
    db.saveRule(rule1, vec1);

    const fetched = db.getRule('prefer-result-type');
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe(rule1.title);
    expect(fetched?.evidence.length).toBe(1);

    // Search with matching file glob
    const searchMatch = db.searchRules({
      filePath: 'src/services/auth.service.ts',
      embedding: embedder.embed('exception handling in service'),
      limit: 5,
    });

    expect(searchMatch.length).toBe(1);
    expect(searchMatch[0].rule.id).toBe('prefer-result-type');

    // Search with non-matching file glob
    const noMatch = db.searchRules({
      filePath: 'src/styles/app.css',
      limit: 5,
    });
    expect(noMatch.length).toBe(0);
  });

  it('tracks processed comments to prevent duplicate mining', () => {
    expect(db.hasCommentBeenProcessed(999)).toBe(false);
    db.markCommentProcessed(999, 12, 'org/repo', 'dev');
    expect(db.hasCommentBeenProcessed(999)).toBe(true);
  });

  it('exports rules to markdown documentation', () => {
    const rule: Rule = {
      id: 'camelcase-vars',
      title: 'Always use camelCase for local variables',
      category: 'naming',
      description: 'Team enforces strict camelCase.',
      guidelines: ['camelCase for vars'],
      positiveExamples: ['const myVar = 1;'],
      negativeExamples: ['const my_var = 1;'],
      applicableGlobs: ['**/*.ts'],
      severity: 'warning',
      confidence: 0.85,
      occurrenceCount: 2,
      evidence: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    db.saveRule(rule);

    const md = db.exportToMarkdown();
    expect(md).toContain('# GitLaw Team Conventions');
    expect(md).toContain('Always use camelCase for local variables');
  });
});
