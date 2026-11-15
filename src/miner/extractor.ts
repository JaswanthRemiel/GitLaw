import { ILLMProvider, LLMMessage, MinedPRComment, Rule } from '../types/index.js';

export interface ExtractedRuleCandidate {
  title: string;
  category: Rule['category'];
  description: string;
  guidelines: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  applicableGlobs: string[];
  severity: Rule['severity'];
  confidence: number;
  sourceCommentId: string | number;
}

export class ConventionExtractor {
  constructor(private llm: ILLMProvider) {}

  public async extractRulesFromComments(
    comments: MinedPRComment[]
  ): Promise<ExtractedRuleCandidate[]> {
    if (comments.length === 0) return [];

    const commentsPayload = comments.map(c => ({
      commentId: c.id,
      prNumber: c.prNumber,
      author: c.author,
      file: c.path,
      diffHunk: c.diffHunk ? c.diffHunk.slice(0, 300) : '',
      commentText: c.body,
    }));

    const systemPrompt = `You are an expert software architect analyzing code review comments from engineering teams.
Your objective is to identify TRUE UNWRITTEN TEAM CONVENTIONS, CODING STANDARDS, and ARCHITECTURAL RULES that are enforced across PRs.

Filter out:
- One-off local bug fixes that do not represent a generalizable rule
- Pure questions or clarifications
- Trivial subjective preferences not backed by team consensus

For each genuine team convention discovered, extract:
- title: concise imperative title (e.g. "Use Result<T, E> pattern instead of throwing raw exceptions")
- category: one of ["architecture", "naming", "error-handling", "testing", "security", "typing", "performance", "formatting", "documentation", "other"]
- description: clear rationale explaining WHY the team requires this rule
- guidelines: array of actionable bullet points
- positiveExamples: code snippets illustrating the preferred pattern
- negativeExamples: code snippets illustrating the anti-pattern
- applicableGlobs: array of file glob patterns this applies to (e.g. ["src/**/*.service.ts", "**/*.controller.ts"])
- severity: "error" (must fix), "warning" (should fix), or "info" (suggestion)
- confidence: number between 0.0 and 1.0 representing how confident this is an established team rule
- sourceCommentId: ID of the comment that demonstrated this rule`;

    const userPrompt = `Here is a batch of code review comments from past pull requests:\n${JSON.stringify(
      commentsPayload,
      null,
      2
    )}\n\nAnalyze each comment and extract all recurring or clear team conventions. If a comment is just a local bug fix or non-reusable remark, omit it.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const schemaDescription = `{
      "rules": [
        {
          "title": "string",
          "category": "architecture|naming|error-handling|testing|security|typing|performance|formatting|documentation|other",
          "description": "string",
          "guidelines": ["string"],
          "positiveExamples": ["string"],
          "negativeExamples": ["string"],
          "applicableGlobs": ["string"],
          "severity": "error|warning|info",
          "confidence": 0.85,
          "sourceCommentId": 123
        }
      ]
    }`;

    try {
      const response = await this.llm.generateStructured<{ rules: ExtractedRuleCandidate[] }>(
        messages,
        schemaDescription,
        { temperature: 0.1 }
      );
      return response.rules || [];
    } catch (err) {
      console.error('Failed to extract rules from LLM:', err);
      return [];
    }
  }
}
