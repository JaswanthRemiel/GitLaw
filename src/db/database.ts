import DatabaseConstructor, { Database as SQLiteDatabase } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import picomatch from 'picomatch';
import { Rule, RuleEvidence, SearchRulesQuery, PRReviewSummary, RuleCategory, RuleSeverity } from '../types/index.js';
import { cosineSimilarity } from '../llm/embedder.js';

export class RuleDatabase {
  private db: SQLiteDatabase;

  constructor(dbPath?: string) {
    const finalPath = dbPath || process.env.GITLAW_DB_PATH || path.join(process.cwd(), '.gitlaw', 'rules.sqlite');
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseConstructor(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        guidelines TEXT NOT NULL,
        positive_examples TEXT NOT NULL,
        negative_examples TEXT NOT NULL,
        applicable_globs TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        evidence TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rule_embeddings (
        rule_id TEXT PRIMARY KEY REFERENCES rules(id) ON DELETE CASCADE,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mined_comments (
        comment_id TEXT PRIMARY KEY,
        pr_number INTEGER NOT NULL,
        repository TEXT NOT NULL,
        author TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        violations_count INTEGER NOT NULL,
        decision TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);
      CREATE INDEX IF NOT EXISTS idx_mined_comments_repo_pr ON mined_comments(repository, pr_number);
    `);
  }

  public saveRule(rule: Rule, embedding?: number[]): void {
    const upsertStmt = this.db.prepare(`
      INSERT INTO rules (
        id, title, category, description, guidelines,
        positive_examples, negative_examples, applicable_globs,
        severity, confidence, occurrence_count, evidence, created_at, updated_at
      ) VALUES (
        @id, @title, @category, @description, @guidelines,
        @positive_examples, @negative_examples, @applicable_globs,
        @severity, @confidence, @occurrence_count, @evidence, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        description = excluded.description,
        guidelines = excluded.guidelines,
        positive_examples = excluded.positive_examples,
        negative_examples = excluded.negative_examples,
        applicable_globs = excluded.applicable_globs,
        severity = excluded.severity,
        confidence = excluded.confidence,
        occurrence_count = excluded.occurrence_count,
        evidence = excluded.evidence,
        updated_at = excluded.updated_at
    `);

    upsertStmt.run({
      id: rule.id,
      title: rule.title,
      category: rule.category,
      description: rule.description,
      guidelines: JSON.stringify(rule.guidelines),
      positive_examples: JSON.stringify(rule.positiveExamples),
      negative_examples: JSON.stringify(rule.negativeExamples),
      applicable_globs: JSON.stringify(rule.applicableGlobs),
      severity: rule.severity,
      confidence: rule.confidence,
      occurrence_count: rule.occurrenceCount || 1,
      evidence: JSON.stringify(rule.evidence),
      created_at: rule.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const vecToStore = embedding || rule.embedding;
    if (vecToStore && vecToStore.length > 0) {
      const float32 = new Float32Array(vecToStore);
      const buffer = Buffer.from(float32.buffer);

      const embedStmt = this.db.prepare(`
        INSERT INTO rule_embeddings (rule_id, dimensions, vector)
        VALUES (?, ?, ?)
        ON CONFLICT(rule_id) DO UPDATE SET
          dimensions = excluded.dimensions,
          vector = excluded.vector
      `);
      embedStmt.run(rule.id, vecToStore.length, buffer);
    }
  }

  public getRule(id: string): Rule | null {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRowToRule(row);
  }

  public getAllRules(): Rule[] {
    const rows = this.db.prepare('SELECT * FROM rules ORDER BY confidence DESC, occurrence_count DESC').all() as any[];
    return rows.map(r => this.mapRowToRule(r));
  }

  public deleteRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM rule_embeddings WHERE rule_id = ?').run(id);
    return result.changes > 0;
  }

  public searchRules(query: SearchRulesQuery): { rule: Rule; similarity: number }[] {
    const allRules = this.getAllRules();
    const results: { rule: Rule; similarity: number }[] = [];

    // Load embeddings for vector search
    const embeddingRows = this.db.prepare('SELECT rule_id, dimensions, vector FROM rule_embeddings').all() as any[];
    const embeddingMap = new Map<string, number[]>();

    for (const er of embeddingRows) {
      const buffer = er.vector as Buffer;
      const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, er.dimensions);
      embeddingMap.set(er.rule_id, Array.from(float32));
    }

    for (const rule of allRules) {
      // Filter by category
      if (query.category && rule.category !== query.category) {
        continue;
      }

      // Filter by min confidence
      if (query.minConfidence !== undefined && rule.confidence < query.minConfidence) {
        continue;
      }

      // Filter by file path glob if provided
      if (query.filePath && rule.applicableGlobs.length > 0) {
        const isMatch = rule.applicableGlobs.some(glob => {
          try {
            return picomatch(glob)(query.filePath!);
          } catch {
            return false;
          }
        });
        if (!isMatch) {
          continue;
        }
      }

      let similarity = 1.0;

      // Vector cosine similarity if query embedding provided
      if (query.embedding && query.embedding.length > 0) {
        const ruleVec = embeddingMap.get(rule.id);
        if (ruleVec) {
          similarity = cosineSimilarity(query.embedding, ruleVec);
        } else {
          similarity = 0.5; // fallback neutral score
        }
      } else if (query.text) {
        // Keyword text matching fallback
        const q = query.text.toLowerCase();
        const inTitle = rule.title.toLowerCase().includes(q);
        const inDesc = rule.description.toLowerCase().includes(q);
        similarity = inTitle ? 0.9 : inDesc ? 0.7 : 0.3;
      }

      results.push({ rule, similarity });
    }

    // Sort by descending similarity, then confidence
    results.sort((a, b) => {
      if (Math.abs(b.similarity - a.similarity) > 0.05) {
        return b.similarity - a.similarity;
      }
      return b.rule.confidence - a.rule.confidence;
    });

    if (query.limit && query.limit > 0) {
      return results.slice(0, query.limit);
    }
    return results;
  }

  public hasCommentBeenProcessed(commentId: string | number): boolean {
    const row = this.db.prepare('SELECT 1 FROM mined_comments WHERE comment_id = ?').get(String(commentId));
    return Boolean(row);
  }

  public markCommentProcessed(
    commentId: string | number,
    prNumber: number,
    repository: string,
    author: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO mined_comments (comment_id, pr_number, repository, author, processed_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(String(commentId), prNumber, repository, author, new Date().toISOString());
  }

  public recordReview(summary: PRReviewSummary): void {
    const stmt = this.db.prepare(`
      INSERT INTO review_history (repository, pr_number, violations_count, decision, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      summary.repository,
      summary.prNumber,
      summary.violations.length,
      summary.decision,
      summary.summaryComment,
      new Date().toISOString()
    );
  }

  public getStats(): { ruleCount: number; processedCommentsCount: number; reviewsCount: number } {
    const ruleCount = (this.db.prepare('SELECT COUNT(*) as c FROM rules').get() as any).c;
    const processedCommentsCount = (this.db.prepare('SELECT COUNT(*) as c FROM mined_comments').get() as any).c;
    const reviewsCount = (this.db.prepare('SELECT COUNT(*) as c FROM review_history').get() as any).c;

    return { ruleCount, processedCommentsCount, reviewsCount };
  }

  public exportToJson(): string {
    return JSON.stringify(this.getAllRules(), null, 2);
  }

  public exportToMarkdown(): string {
    const rules = this.getAllRules();
    let md = `# GitLaw Team Conventions\n\n`;
    md += `*Automatically mined from past code reviews and reinforced on new pull requests.*\n\n`;
    md += `**Total Active Conventions:** ${rules.length}\n\n---\n\n`;

    const categories: Record<string, Rule[]> = {};
    for (const r of rules) {
      categories[r.category] = categories[r.category] || [];
      categories[r.category].push(r);
    }

    for (const [category, catRules] of Object.entries(categories)) {
      md += `## ${category.toUpperCase()}\n\n`;
      for (const rule of catRules) {
        md += `### ${rule.title} (${rule.severity.toUpperCase()})\n\n`;
        md += `**ID:** \`${rule.id}\` | **Confidence:** ${(rule.confidence * 100).toFixed(0)}% | **Occurrences:** ${rule.occurrenceCount}\n\n`;
        md += `${rule.description}\n\n`;

        if (rule.guidelines.length > 0) {
          md += `**Guidelines:**\n`;
          for (const g of rule.guidelines) md += `- ${g}\n`;
          md += `\n`;
        }

        if (rule.applicableGlobs.length > 0) {
          md += `**Applies to files:** \`${rule.applicableGlobs.join(', ')}\`\n\n`;
        }

        if (rule.positiveExamples.length > 0) {
          md += `**Preferred pattern:**\n\`\`\`\n${rule.positiveExamples.join('\n')}\n\`\`\`\n\n`;
        }

        if (rule.negativeExamples.length > 0) {
          md += `**Anti-pattern to avoid:**\n\`\`\`\n${rule.negativeExamples.join('\n')}\n\`\`\`\n\n`;
        }

        if (rule.evidence.length > 0) {
          md += `**Past Review Evidence:**\n`;
          for (const ev of rule.evidence.slice(0, 3)) {
            md += `- PR #${ev.prNumber} by @${ev.author}: *"${ev.commentBody.replace(/\n/g, ' ').slice(0, 120)}..."*\n`;
          }
          md += `\n`;
        }
        md += `---\n\n`;
      }
    }

    return md;
  }

  public close(): void {
    this.db.close();
  }

  private mapRowToRule(row: any): Rule {
    return {
      id: row.id,
      title: row.title,
      category: row.category as RuleCategory,
      description: row.description,
      guidelines: JSON.parse(row.guidelines),
      positiveExamples: JSON.parse(row.positive_examples),
      negativeExamples: JSON.parse(row.negative_examples),
      applicableGlobs: JSON.parse(row.applicable_globs),
      severity: row.severity as RuleSeverity,
      confidence: row.confidence,
      occurrenceCount: row.occurrence_count,
      evidence: JSON.parse(row.evidence),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
