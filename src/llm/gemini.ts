import { ILLMProvider, LLMMessage, LLMCompletionOptions } from '../types/index.js';
import { LocalVectorEmbedder } from './embedder.js';

export class GeminiProvider implements ILLMProvider {
  public readonly name = 'gemini';
  private apiKey: string;
  private model: string;
  private embeddingModel: string;
  private fallbackEmbedder = new LocalVectorEmbedder();

  constructor(options?: { apiKey?: string; model?: string; embeddingModel?: string }) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = options?.model || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
    this.embeddingModel = options?.embeddingModel || 'text-embedding-004';
  }

  public async generateText(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxTokens ?? 2500,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  public async generateStructured<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMCompletionOptions
  ): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const instruction = `You are a strict JSON generator. Return valid JSON adhering to:\n${schemaDescription}`;
    const contents = [
      { role: 'user', parts: [{ text: instruction }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ];

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: options?.temperature ?? 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(raw) as T;
  }

  public async embed(text: string): Promise<number[]> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:embedContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.embeddingModel}`,
          content: { parts: [{ text }] },
        }),
      });

      if (!response.ok) {
        return this.fallbackEmbedder.embed(text);
      }

      const data = (await response.json()) as {
        embedding?: { values?: number[] };
      };
      return data.embedding?.values || this.fallbackEmbedder.embed(text);
    } catch {
      return this.fallbackEmbedder.embed(text);
    }
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
