import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { chunkText } from "./chunker";
import type { EmbeddingClient } from "./client";

export interface EmbeddingService {
  /**
   * Chunk a document version's content, generate embeddings, and upsert rows
   * into `document_embeddings`. Deletes existing rows for the version first
   * so re-embedding is safe to call multiple times.
   */
  embedDocument(documentVersionId: string, content: string): Promise<void>;
}

/** Rough token count estimate used for metadata. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format a float array as a pgvector-compatible string, e.g. "[0.1,0.2,...]".
 * JSON.stringify produces exactly this format for numeric arrays.
 */
function vectorToString(embedding: number[]): string {
  return JSON.stringify(embedding);
}

export function createEmbeddingService(
  supabase: SupabaseClient<Database>,
  embeddingClient: EmbeddingClient,
): EmbeddingService {
  async function embedDocument(documentVersionId: string, content: string): Promise<void> {
    // Delete existing embeddings for this version (idempotent re-embedding)
    const { error: deleteError } = await supabase
      .from("document_embeddings")
      .delete()
      .eq("document_version_id", documentVersionId);

    if (deleteError) {
      throw new Error(`Failed to clear old embeddings: ${deleteError.message}`);
    }

    // Chunk the content
    const chunks = chunkText(content);
    if (chunks.length === 0) return;

    // Embed all chunks (batched internally by the client)
    const texts = chunks.map((c) => c.text);
    const embeddings = await embeddingClient.embedBatch(texts);

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`);
    }

    // Build insert rows
    const rows = chunks.map((chunk, i) => ({
      document_version_id: documentVersionId,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      embedding: vectorToString(embeddings[i] ?? []),
      metadata: { token_count: estimateTokens(chunk.text) },
    }));

    const { error: insertError } = await supabase.from("document_embeddings").insert(rows);

    if (insertError) {
      throw new Error(`Failed to insert embeddings: ${insertError.message}`);
    }
  }

  return { embedDocument };
}
