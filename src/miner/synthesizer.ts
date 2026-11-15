import { ILLMProvider, MinedPRComment, Rule, RuleEvidence } from '../types/index.js';
import { RuleDatabase } from '../db/database.js';
import { ExtractedRuleCandidate } from './extractor.js';
import { cosineSimilarity } from '../llm/embedder.js';

export class RuleSynthesizer {
  constructor(private db: RuleDatabase, private llm: ILLMProvider) {}

  public async synthesizeAndPersist(
    candidates: ExtractedRuleCandidate[],
    rawComments: MinedPRComment[]
  ): Promise<Rule[]> {
    const commentsMap = new Map<string | number, MinedPRComment>();
    for (const c of rawComments) {
      commentsMap.set(c.id, c);
    }

    const processedRules: Rule[] = [];

    for (const candidate of candidates) {
      const sourceComment = commentsMap.get(candidate.sourceCommentId);
      const evidenceItem: RuleEvidence = {
        prNumber: sourceComment ? sourceComment.prNumber : 0,
        prUrl: sourceComment ? sourceComment.prUrl : undefined,
        commentId: candidate.sourceCommentId,
        author: sourceComment ? sourceComment.author : 'unknown',
        commentBody: sourceComment ? sourceComment.body : '',
        diffHunk: sourceComment ? sourceComment.diffHunk : undefined,
        path: sourceComment ? sourceComment.path : undefined,
        createdAt: sourceComment ? sourceComment.createdAt : new Date().toISOString(),
      };

      const candidateEmbedding = await this.llm.embed(
        `${candidate.title} ${candidate.category} ${candidate.description} ${candidate.guidelines.join(' ')}`
      );

      // Check if a matching rule already exists in DB
      const existingMatches = this.db.searchRules({
        embedding: candidateEmbedding,
        limit: 3,
      });

      const bestMatch = existingMatches[0];
      const isDuplicate = bestMatch && bestMatch.similarity > 0.78;

      if (isDuplicate) {
        // Merge with existing rule
        const existing = bestMatch.rule;
        const alreadyHasEvidence = existing.evidence.some(e => e.commentId === evidenceItem.commentId);

        if (!alreadyHasEvidence) {
          existing.evidence.push(evidenceItem);
          existing.occurrenceCount += 1;
        }

        // Strengthen confidence as more team members enforce it
        existing.confidence = Math.min(0.99, existing.confidence + 0.05);

        // Merge guidelines and examples
        for (const g of candidate.guidelines) {
          if (!existing.guidelines.some(eg => eg.toLowerCase() === g.toLowerCase())) {
            existing.guidelines.push(g);
          }
        }

        for (const pe of candidate.positiveExamples) {
          if (!existing.positiveExamples.includes(pe)) {
            existing.positiveExamples.push(pe);
          }
        }

        for (const ne of candidate.negativeExamples) {
          if (!existing.negativeExamples.includes(ne)) {
            existing.negativeExamples.push(ne);
          }
        }

        // Expand applicable globs if new globs found
        for (const glob of candidate.applicableGlobs) {
          if (!existing.applicableGlobs.includes(glob)) {
            existing.applicableGlobs.push(glob);
          }
        }

        existing.updatedAt = new Date().toISOString();
        this.db.saveRule(existing, candidateEmbedding);
        processedRules.push(existing);
      } else {
        // Create new rule
        const slug = this.generateSlug(candidate.title);
        const newRule: Rule = {
          id: slug,
          title: candidate.title,
          category: candidate.category,
          description: candidate.description,
          guidelines: candidate.guidelines,
          positiveExamples: candidate.positiveExamples,
          negativeExamples: candidate.negativeExamples,
          applicableGlobs: candidate.applicableGlobs,
          severity: candidate.severity,
          confidence: candidate.confidence,
          occurrenceCount: 1,
          evidence: [evidenceItem],
          embedding: candidateEmbedding,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        this.db.saveRule(newRule, candidateEmbedding);
        processedRules.push(newRule);
      }
    }

    return processedRules;
  }

  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 50);

    const hash = Math.floor(Math.random() * 10000).toString(16);
    return `${base}-${hash}`;
  }
}
