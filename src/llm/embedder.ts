/**
 * Local Fallback Vector Embedder
 * Produces 256-dimensional normalized vectors using hashed char/word n-grams and term frequency.
 * Guarantees that even without external embedding API quotas or network access,
 * semantic vector retrieval still functions with cosine similarity.
 */
export class LocalVectorEmbedder {
  private readonly dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  public embed(text: string): number[] {
    const vector = new Float32Array(this.dimensions);
    const normalized = text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, ' ');
    const tokens = normalized.split(/\s+/).filter(t => t.length > 1);

    // 1-grams and 2-grams
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const h1 = this.hashString(token) % this.dimensions;
      vector[h1] += 1.0;

      if (i + 1 < tokens.length) {
        const bigram = `${token}_${tokens[i + 1]}`;
        const h2 = this.hashString(bigram) % this.dimensions;
        vector[h2] += 1.5;
      }
    }

    // Code-specific tokens (camelCase, snake_case chunks)
    const codeTokens = text.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|\d+/g) || [];
    for (const c of codeTokens) {
      if (c.length > 2) {
        const h = this.hashString(c.toLowerCase()) % this.dimensions;
        vector[h] += 1.2;
      }
    }

    // Normalize to unit vector for cosine distance
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] /= norm;
      }
    }

    return Array.from(vector);
  }

  public embedBatch(texts: string[]): number[][] {
    return texts.map(t => this.embed(t));
  }

  private hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }
}

/**
 * Calculates cosine similarity between two normalized vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
