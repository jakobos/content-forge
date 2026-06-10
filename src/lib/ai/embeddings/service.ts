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
    // Chunk the content
    const chunks = chunkText(content);

    if (chunks.length === 0) {
      // Nothing to embed — delete any stale rows from a previous version
      const { error: deleteError } = await supabase
        .from("document_embeddings")
        .delete()
        .eq("document_version_id", documentVersionId);
      if (deleteError) {
        throw new Error(`Failed to clear old embeddings: ${deleteError.message}`);
      }
      return;
    }

    // Embed all chunks (batched internally by the client)
    // This external call happens BEFORE any writes so that a failure here
    // leaves existing embeddings intact.
    const texts = chunks.map((c) => c.text);
    const embeddings = await embeddingClient.embedBatch(texts);

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`);
    }

    // Build upsert rows — conflict target is (document_version_id, chunk_index)
    const rows = chunks.map((chunk, i) => ({
      document_version_id: documentVersionId,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      embedding: vectorToString(embeddings[i] ?? []),
      metadata: { token_count: estimateTokens(chunk.text) },
    }));

    // Upsert: write all new rows before removing anything.
    // Existing rows are updated in place; new rows are inserted.
    // A failure here leaves the old embeddings untouched.
    const { error: upsertError } = await supabase
      .from("document_embeddings")
      .upsert(rows, { onConflict: "document_version_id,chunk_index" });

    if (upsertError) {
      throw new Error(`Failed to upsert embeddings: ${upsertError.message}`);
    }

    // Remove stale tail chunks from a previously longer document version.
    // This delete runs only after the new data is committed.
    const { error: deleteError } = await supabase
      .from("document_embeddings")
      .delete()
      .eq("document_version_id", documentVersionId)
      .gte("chunk_index", chunks.length);

    if (deleteError) {
      throw new Error(`Failed to remove stale embeddings: ${deleteError.message}`);
    }
  }

  return { embedDocument };
}
