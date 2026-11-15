import { describe, it, expect } from 'vitest';
import { LocalVectorEmbedder, cosineSimilarity } from '../src/llm/embedder';

describe('LocalVectorEmbedder', () => {
  const embedder = new LocalVectorEmbedder(128);

  it('generates normalized vectors of configured dimension', () => {
    const vec = embedder.embed('Always use Result type instead of throwing exceptions');
    expect(vec.length).toBe(128);

    // Check unit vector norm ~ 1.0
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  });

  it('computes higher cosine similarity for semantically similar statements', () => {
    const vec1 = embedder.embed('Prefer Result type over throwing raw Error exceptions in service methods');
    const vec2 = embedder.embed('Domain services must return Result rather than throw Error');
    const vec3 = embedder.embed('Always name CSS color variables with kebab-case in stylesheet');

    const sim12 = cosineSimilarity(vec1, vec2);
    const sim13 = cosineSimilarity(vec1, vec3);

    expect(sim12).toBeGreaterThan(sim13);
  });

  it('returns 1.0 similarity for identical vectors', () => {
    const vec = embedder.embed('Database migrations must have indexes');
    const sim = cosineSimilarity(vec, vec);
    expect(sim).toBeCloseTo(1.0, 4);
  });
});
