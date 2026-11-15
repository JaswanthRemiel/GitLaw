import OpenAI from 'openai';
import { ILLMProvider, LLMMessage, LLMCompletionOptions } from '../types/index.js';
import { LocalVectorEmbedder } from './embedder.js';

export class OpenAIProvider implements ILLMProvider {
  public readonly name = 'openai';
  private client: OpenAI;
  private model: string;
  private embeddingModel: string;
  private fallbackEmbedder = new LocalVectorEmbedder();

  constructor(options?: { apiKey?: string; baseURL?: string; model?: string; embeddingModel?: string }) {
    this.client = new OpenAI({
      apiKey: options?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: options?.baseURL || process.env.OPENAI_BASE_URL,
    });
    this.model = options?.model || process.env.OPENAI_MODEL || 'gpt-4o';
    this.embeddingModel = options?.embeddingModel || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  }

  public async generateText(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 2500,
    });

    return response.choices[0]?.message?.content || '';
  }

  public async generateStructured<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMCompletionOptions
  ): Promise<T> {
    const systemPrompt = `You must respond with valid JSON strictly matching this schema or structure:\n${schemaDescription}\nDo not include backticks or markdown fences in the response. Output raw JSON only.`;

    const fullMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: fullMessages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.1,
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content || '{}';
    return JSON.parse(text) as T;
  }

  public async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: text,
      });
      return response.data[0].embedding;
    } catch {
      return this.fallbackEmbedder.embed(text);
    }
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: texts,
      });
      return response.data.map(d => d.embedding);
    } catch {
      return this.fallbackEmbedder.embedBatch(texts);
    }
  }
}
