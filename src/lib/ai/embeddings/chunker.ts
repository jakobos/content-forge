export interface Chunk {
  index: number;
  text: string;
}

/**
 * Split a document into paragraph-based chunks suitable for embedding.
 *
 * Strategy:
 *  1. Split on double newlines → raw paragraphs
 *  2. Merge consecutive short paragraphs up to maxChars
 *  3. Split any chunk still exceeding maxChars at sentence then word boundaries
 */
export function chunkText(text: string, options?: { maxTokensPerChunk?: number }): Chunk[] {
  const maxTokens = options?.maxTokensPerChunk ?? 500;
  // Rough token estimate: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  // Don't merge a paragraph into current unless it's still short
  const minMergeChars = 100;

  // Step 1: raw paragraphs
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  // Step 2: merge short consecutive paragraphs
  const merged: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const combined = current ? `${current}\n\n${para}` : para;
    if (combined.length <= maxChars || current.length < minMergeChars) {
      current = combined;
    } else {
      merged.push(current);
      current = para;
    }
  }
  if (current) merged.push(current);

  // Step 3: split oversized chunks
  const chunks: string[] = [];

  for (const chunk of merged) {
    if (chunk.length <= maxChars) {
      chunks.push(chunk);
      continue;
    }
    splitLong(chunk, maxChars, chunks);
  }

  return chunks
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t, i) => ({ index: i, text: t }));
}

/** Split an oversized string into pieces at sentence then word boundaries. */
function splitLong(text: string, maxChars: number, out: string[]): void {
  let remaining = text;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);

    // Prefer sentence boundary in the second half of the window
    const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));

    let splitAt: number;
    if (sentenceEnd > maxChars / 2) {
      splitAt = sentenceEnd + 2; // include ". "
    } else {
      // Fall back to last word boundary
      const wordEnd = window.lastIndexOf(" ");
      splitAt = wordEnd > 0 ? wordEnd + 1 : maxChars;
    }

    out.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) out.push(remaining);
}
