import { ILLMProvider, LLMMessage, Rule, RuleViolation } from '../types/index.js';
import { MatchedCandidateRules } from './matcher.js';

export class PRViolationAnalyzer {
  constructor(private llm: ILLMProvider) {}

  public async analyzeHunks(
    matchedHunks: MatchedCandidateRules[],
    options?: { minConfidence?: number }
  ): Promise<RuleViolation[]> {
    const minConfidence = options?.minConfidence ?? 0.75;
    const allViolations: RuleViolation[] = [];

    for (const item of matchedHunks) {
      if (item.rules.length === 0 || item.hunk.addedLines.length === 0) {
        continue;
      }

      const file = item.file;
      const hunk = item.hunk;
      const rules = item.rules;

      const systemPrompt = `You are GitLaw, an automated code reviewer enforcing a team's learned conventions and unwritten rules.
You are given a code diff hunk with specific added line numbers, and a set of candidate conventions learned from the team's past PR reviews.

Your job:
1. Determine if any added lines violate one or more of the candidate conventions.
2. Be extremely precise. DO NOT hallucinate violations or invent rules. Only flag genuine violations.
3. For each violation:
   - Identify the EXACT line number (from the added lines list).
   - Quote the violating code snippet.
   - Provide a suggested fix (drop-in replacement).
   - Write a polite, constructive explanation referencing the team's standard.
   - Assign a confidence score (0.0 to 1.0).

Return JSON only.`;

      const candidateRulesSummary = rules.map(r => ({
        id: r.id,
        title: r.title,
        category: r.category,
        description: r.description,
        guidelines: r.guidelines,
        positiveExamples: r.positiveExamples,
        negativeExamples: r.negativeExamples,
        severity: r.severity,
        evidence: r.evidence.slice(0, 2).map(e => ({
          prNumber: e.prNumber,
          author: e.author,
          commentQuote: e.commentBody.slice(0, 150),
        })),
      }));

      const hunkContext = {
        file,
        hunkHeader: hunk.hunkHeader,
        addedLinesWithNumbers: hunk.addedLines,
      };

      const userPrompt = `File: ${file}
Diff Added Lines:
${JSON.stringify(hunk.addedLines, null, 2)}

Candidate Team Conventions to check against:
${JSON.stringify(candidateRulesSummary, null, 2)}

Audit these added lines against the candidate rules. Output any violations found.`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const schemaDescription = `{
        "violations": [
          {
            "ruleId": "string",
            "line": 42,
            "violatingCode": "string",
            "suggestedFix": "string",
            "message": "string",
            "confidence": 0.9
          }
        ]
      }`;

      try {
        const response = await this.llm.generateStructured<{ violations: Array<{
          ruleId: string;
          line: number;
          violatingCode: string;
          suggestedFix?: string;
          message: string;
          confidence: number;
        }> }>(messages, schemaDescription, { temperature: 0.1 });

        if (response.violations && Array.isArray(response.violations)) {
          for (const v of response.violations) {
            if (v.confidence < minConfidence) continue;

            const matchedRule = rules.find(r => r.id === v.ruleId) || rules[0];

            allViolations.push({
              ruleId: matchedRule.id,
              ruleTitle: matchedRule.title,
              category: matchedRule.category,
              severity: matchedRule.severity,
              confidence: v.confidence,
              file,
              line: v.line,
              hunkHeader: hunk.hunkHeader,
              violatingCode: v.violatingCode,
              suggestedFix: v.suggestedFix,
              message: v.message,
              citations: matchedRule.evidence.slice(0, 3).map(e => ({
                prNumber: e.prNumber,
                prUrl: e.prUrl,
                author: e.author,
                commentQuote: e.commentBody.slice(0, 120),
              })),
            });
          }
        }
      } catch (err) {
        console.warn(`[GitLaw Reviewer] Warning: failed to evaluate hunk in ${file}:`, err);
      }
    }

    return allViolations;
  }
}
