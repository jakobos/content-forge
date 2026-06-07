const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const DEFAULT_BATCH_SIZE = 20;
const MAX_RETRIES = 3;

// Local types for the OpenRouter embeddings API response
interface OREmbeddingItem {
  embedding: number[];
  index: number;
}

interface OREmbeddingResponse {
  data: OREmbeddingItem[];
}

export interface EmbeddingClient {
  /** Embed a single text string. Returns a 1536-dimensional float array. */
  embed(text: string): Promise<number[]>;
  /**
   * Embed multiple texts. Internally batched into groups of `batchSize`
   * (default 20) to stay within API limits. Returns arrays in the same order
   * as the input.
   */
  embedBatch(texts: string[], batchSize?: number): Promise<number[][]>;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Max retries exceeded");
}

async function callEmbeddingsApi(apiKey: string, input: string[]): Promise<number[][]> {
  return withRetry(async () => {
    const response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embeddings API error ${response.status}: ${errText}`);
    }

    const raw: unknown = (await response.json()) as unknown;
    const body = raw as OREmbeddingResponse;

    // Sort by index to preserve input order (API may reorder)
    const sorted = [...body.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  });
}

export function createEmbeddingClient(apiKey: string): EmbeddingClient {
  async function embed(text: string): Promise<number[]> {
    const results = await callEmbeddingsApi(apiKey, [text]);
    const first = results.at(0);
    if (first === undefined) throw new Error("No embedding returned from API");
    return first;
  }

  async function embedBatch(texts: string[], batchSize: number = DEFAULT_BATCH_SIZE): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await callEmbeddingsApi(apiKey, batch);
      results.push(...batchResults);
    }

    return results;
  }

  return { embed, embedBatch };
}
