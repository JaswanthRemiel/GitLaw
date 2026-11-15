import { RuleDatabase } from '../db/database.js';
import { ILLMProvider, Rule } from '../types/index.js';
import { ParsedDiffHunk } from './diff-parser.js';

export interface MatchedCandidateRules {
  file: string;
  hunk: ParsedDiffHunk;
  rules: Rule[];
}

export class RuleMatcher {
  constructor(private db: RuleDatabase, private llm: ILLMProvider) {}

  public async findCandidateRulesForHunks(
    hunks: ParsedDiffHunk[],
    options?: { maxRulesPerHunk?: number; minSimilarity?: number }
  ): Promise<MatchedCandidateRules[]> {
    const maxRules = options?.maxRulesPerHunk ?? 5;
    const minSim = options?.minSimilarity ?? 0.35;
    const results: MatchedCandidateRules[] = [];

    // All active rules in DB
    const allRules = this.db.getAllRules();
    if (allRules.length === 0) {
      return hunks.map(h => ({ file: h.file, hunk: h, rules: [] }));
    }

    for (const hunk of hunks) {
      // 1. First filter rules applicable by file path
      const pathMatchedRules = this.db.searchRules({
        filePath: hunk.file,
        limit: 20,
      });

      // 2. Compute embedding of the code changes in this hunk
      const addedCode = hunk.addedLines.map(l => l.text).join('\n');
      const textToEmbed = `${hunk.file}\n${addedCode.slice(0, 500)}`;

      let candidateRules: Rule[] = [];

      try {
        const hunkEmbedding = await this.llm.embed(textToEmbed);

        const semanticMatches = this.db.searchRules({
          filePath: hunk.file,
          embedding: hunkEmbedding,
          limit: maxRules,
        });

        candidateRules = semanticMatches
          .filter(m => m.similarity >= minSim)
          .map(m => m.rule);
      } catch {
        // Fallback to path-matched rules
        candidateRules = pathMatchedRules.slice(0, maxRules).map(m => m.rule);
      }

      // If semantic matching yielded nothing but path matches exist, use top path matches
      if (candidateRules.length === 0 && pathMatchedRules.length > 0) {
        candidateRules = pathMatchedRules.slice(0, 3).map(m => m.rule);
      }

      results.push({
        file: hunk.file,
        hunk,
        rules: candidateRules,
      });
    }

    return results;
  }
}
