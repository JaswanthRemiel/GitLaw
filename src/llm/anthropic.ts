import { ILLMProvider, LLMMessage, LLMCompletionOptions } from '../types/index.js';
import { LocalVectorEmbedder } from './embedder.js';

export class AnthropicProvider implements ILLMProvider {
  public readonly name = 'anthropic';
  private apiKey: string;
  private model: string;
  private fallbackEmbedder = new LocalVectorEmbedder();

  constructor(options?: { apiKey?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = options?.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  }

  public async generateText(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<string> {
    const url = 'https://api.anthropic.com/v1/messages';

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 2500,
        temperature: options?.temperature ?? 0.2,
        system: systemMsg,
        messages: chatMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    return data.content?.find(c => c.type === 'text')?.text || '';
  }

  public async generateStructured<T>(
    messages: LLMMessage[],
    schemaDescription: string,
    options?: LLMCompletionOptions
  ): Promise<T> {
    const instructions = `Return ONLY a valid JSON object matching this schema description:\n${schemaDescription}\nOutput only valid JSON, without any wrapping or markdown formatting.`;

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const augmentedSystem = systemMsg ? `${systemMsg}\n\n${instructions}` : instructions;

    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    const url = 'https://api.anthropic.com/v1/messages';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 2500,
        temperature: options?.temperature ?? 0.1,
        system: augmentedSystem,
        messages: chatMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = data.content?.find(c => c.type === 'text')?.text || '{}';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean) as T;
  }

  public async embed(text: string): Promise<number[]> {
    // Anthropic does not have a dedicated public embedding API, so we use local vector embedder
    return this.fallbackEmbedder.embed(text);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return this.fallbackEmbedder.embedBatch(texts);
  }
}
