import { ILLMProvider, LLMMessage, LLMCompletionOptions, Rule, RuleViolation } from '../types/index.js';
import { LocalVectorEmbedder } from './embedder.js';

export class MockLLMProvider implements ILLMProvider {
  public readonly name = 'mock';
  private embedder = new LocalVectorEmbedder(64);

  public async generateText(messages: LLMMessage[], _options?: LLMCompletionOptions): Promise<string> {
    const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
    return `[MockLLM response for: ${lastUser.slice(0, 80)}...]`;
  }

  public async generateStructured<T>(
    messages: LLMMessage[],
    _schemaDescription: string,
    _options?: LLMCompletionOptions
  ): Promise<T> {
    const prompt = messages.map(m => m.content).join('\n');

    // Rule Extraction Simulation
    if (prompt.includes('extract conventions') || prompt.includes('review comments')) {
      const mockRules: Partial<Rule>[] = [
        {
          id: 'use-result-type-for-errors',
          title: 'Use Result/Either type instead of throwing raw exceptions in domain services',
          category: 'error-handling',
          description: 'Team requires domain services to return explicit Result types rather than throwing unchecked exceptions.',
          guidelines: [
            'Do not throw Error in service methods',
            'Return Result.ok(value) or Result.fail(error)',
            'Handle errors explicitly at controller boundaries',
          ],
          positiveExamples: ['return Result.ok(user);', 'return Result.fail(new NotFoundError());'],
          negativeExamples: ['throw new Error("User not found");'],
          applicableGlobs: ['**/*.service.ts', 'src/domain/**/*.ts'],
          severity: 'error',
          confidence: 0.95,
        },
        {
          id: 'always-specify-table-indexes-in-migrations',
          title: 'Always add composite index on foreign key columns in database migrations',
          category: 'performance',
          description: 'Foreign key columns must always have an explicit index defined to prevent table lock escalation during deletes.',
          guidelines: [
            'Define index on every foreign key column',
            'Name indexes with idx_<table_name>_<col_name>',
          ],
          positiveExamples: ['table.index(["organization_id", "created_at"]);'],
          negativeExamples: ['table.integer("organization_id").references("id").inTable("organizations"); // without index'],
          applicableGlobs: ['**/migrations/**/*.ts', '**/migrations/**/*.sql'],
          severity: 'warning',
          confidence: 0.88,
        },
      ];

      return { rules: mockRules } as unknown as T;
    }

    // PR Review Simulation
    if (prompt.includes('audit this PR diff') || prompt.includes('candidate rules')) {
      const violations: Partial<RuleViolation>[] = [];

      if (prompt.includes('throw new Error') || prompt.includes('throw new')) {
        violations.push({
          ruleId: 'use-result-type-for-errors',
          ruleTitle: 'Use Result/Either type instead of throwing raw exceptions in domain services',
          category: 'error-handling',
          severity: 'error',
          confidence: 0.94,
          file: 'src/services/user.service.ts',
          line: 42,
          violatingCode: 'throw new Error("User not found");',
          suggestedFix: 'return Result.fail(new NotFoundError("User not found"));',
          message: 'Violates team convention: Domain services must return Result<T, E> instead of throwing raw Error instances.',
          citations: [
            {
              prNumber: 104,
              author: 'tech-lead',
              commentQuote: 'Please do not throw raw Error here; return Result.fail so caller is forced to handle it.',
            },
          ],
        });
      }

      return { violations, summary: 'GitLaw audited the pull request against team conventions.' } as unknown as T;
    }

    return {} as T;
  }

  public async embed(text: string): Promise<number[]> {
    return this.embedder.embed(text);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedder.embedBatch(texts);
  }
}
