import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { EmbeddingClient } from "@/lib/ai/embeddings";
import { reciprocalRankFusion } from "./rrf";
import type { RankedResult } from "./rrf";

export interface SearchResult {
  chunkText: string;
  documentVersionId: string;
  chunkIndex: number;
  /** Normalised score (0–1 for vector; RRF combined for hybrid). */
  score: number;
  matchedBy: ("vector" | "fts")[];
}

export interface SearchService {
  search(
    query: string,
    campaignId: string,
    options?: {
      limit?: number;
      strategy?: "hybrid" | "vector" | "fts";
    },
  ): Promise<SearchResult[]>;
}

/** Format a float array as a pgvector-compatible string "[0.1,0.2,...]". */
function vectorToString(embedding: number[]): string {
  return JSON.stringify(embedding);
}

// Shared row shape returned by both RPC functions
interface ChunkRow {
  id: string;
  document_version_id: string;
  chunk_index: number;
  chunk_text: string;
  similarity?: number;
  rank?: number;
}

export function createSearchService(
  supabase: SupabaseClient<Database>,
  embeddingClient: EmbeddingClient,
): SearchService {
  async function search(
    query: string,
    campaignId: string,
    options: { limit?: number; strategy?: "hybrid" | "vector" | "fts" } = {},
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;
    const strategy = options.strategy ?? "hybrid";

    // Embed query for vector search
    const queryEmbedding = strategy !== "fts" ? await embeddingClient.embed(query) : null;

    const vectorRows: ChunkRow[] = [];
    const ftsRows: ChunkRow[] = [];

    // Vector similarity search
    if (strategy !== "fts" && queryEmbedding) {
      const { data: vData, error: vError } = await supabase.rpc("match_document_chunks", {
        query_embedding: vectorToString(queryEmbedding),
        match_threshold: 0.0,
        match_count: limit * 2,
        filter_campaign_id: campaignId,
      });
      if (vError) throw new Error(`Vector search failed: ${vError.message}`);
      vectorRows.push(...vData);
    }

    // Full-text search
    if (strategy !== "vector") {
      const { data: fData, error: fError } = await supabase.rpc("search_document_chunks", {
        search_query: query,
        result_limit: limit * 2,
        filter_campaign_id: campaignId,
      });
      if (fError) throw new Error(`FTS search failed: ${fError.message}`);
      ftsRows.push(...fData);
    }

    // Vector-only: return directly
    if (strategy === "vector") {
      return vectorRows.slice(0, limit).map((row) => ({
        chunkText: row.chunk_text,
        documentVersionId: row.document_version_id,
        chunkIndex: row.chunk_index,
        score: row.similarity ?? 0,
        matchedBy: ["vector" as const],
      }));
    }

    // FTS-only: return directly
    if (strategy === "fts") {
      return ftsRows.slice(0, limit).map((row) => ({
        chunkText: row.chunk_text,
        documentVersionId: row.document_version_id,
        chunkIndex: row.chunk_index,
        score: row.rank ?? 0,
        matchedBy: ["fts" as const],
      }));
    }

    // Hybrid: apply Reciprocal Rank Fusion
    const vectorRanked: RankedResult<ChunkRow>[] = vectorRows.map((row) => ({
      id: row.id,
      data: row,
    }));
    const ftsRanked: RankedResult<ChunkRow>[] = ftsRows.map((row) => ({
      id: row.id,
      data: row,
    }));

    const merged = reciprocalRankFusion(vectorRanked, ftsRanked);

    return merged.slice(0, limit).map((result) => ({
      chunkText: result.data.chunk_text,
      documentVersionId: result.data.document_version_id,
      chunkIndex: result.data.chunk_index,
      score: result.rrfScore,
      matchedBy: result.matchedBy,
    }));
  }

  return { search };
}
