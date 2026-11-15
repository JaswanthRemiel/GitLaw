import { ILLMProvider } from '../types/index.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { AnthropicProvider } from './anthropic.js';
import { MockLLMProvider } from './mock.js';

export function createLLMProvider(options?: { provider?: string; apiKey?: string }): ILLMProvider {
  const chosen = (options?.provider || process.env.LLM_PROVIDER || '').toLowerCase();

  if (chosen === 'mock' || (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY && !options?.apiKey)) {
    if (chosen === 'mock' || process.env.NODE_ENV === 'test') {
      return new MockLLMProvider();
    }
  }

  if (chosen === 'gemini' || (!chosen && process.env.GEMINI_API_KEY)) {
    return new GeminiProvider({ apiKey: options?.apiKey });
  }

  if (chosen === 'anthropic' || (!chosen && process.env.ANTHROPIC_API_KEY)) {
    return new AnthropicProvider({ apiKey: options?.apiKey });
  }

  if (chosen === 'openai' || (!chosen && process.env.OPENAI_API_KEY)) {
    return new OpenAIProvider({ apiKey: options?.apiKey });
  }

  // Fallback to Mock if no keys provided
  return new MockLLMProvider();
}
