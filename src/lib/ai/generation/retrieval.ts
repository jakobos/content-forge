import type { SearchService, SearchResult } from "@/lib/ai/search";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { RankedResult } from "@/lib/ai/search/rrf";
import { reciprocalRankFusion } from "@/lib/ai/search/rrf";

/** Hard cap on seed queries to bound embedding + search cost for large campaigns. */
const MAX_SEED_QUERIES = 12;

/** Hard cap on the final fragment set fed to the LLM. */
const MAX_FRAGMENTS = 20;

/** Per-seed search result limit before RRF merge. */
const PER_SEED_LIMIT = 10;

export interface TaggedFragment {
  /** Stable reference tag (F1, F2, …) assigned in merged-rank order. */
  tag: string;
  chunkText: string;
  documentVersionId: string;
  documentTitle: string;
  chunkIndex: number;
}

interface SeedQueryInput {
  campaignTitle: string;
  campaignGoal: string | null;
  campaignDescription: string | null;
  documents: { title: string; leadText: string }[];
}

/**
 * Derive a deterministic, rule-based set of seed queries.
 * One query from campaign goal/theme + one per document (title + lead), capped at MAX_SEED_QUERIES.
 * No LLM involved.
 */
export function deriveSeedQueries(input: SeedQueryInput): string[] {
  const queries: string[] = [];

  // Goal/theme query — always first
  const goalParts = [input.campaignTitle];
  if (input.campaignGoal) goalParts.push(input.campaignGoal);
  if (input.campaignDescription) goalParts.push(input.campaignDescription);
  queries.push(goalParts.join(" — "));

  // One query per document: title + first 200 chars of lead text
  for (const doc of input.documents) {
    if (queries.length >= MAX_SEED_QUERIES) break;
    const lead = doc.leadText.slice(0, 200).trim();
    const q = lead ? `${doc.title}: ${lead}` : doc.title;
    queries.push(q);
  }

  // Dedupe (exact string matches only)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of queries) {
    if (!seen.has(q)) {
      seen.add(q);
      deduped.push(q);
    }
  }

  return deduped;
}

/**
 * Fetch document titles for a set of document_version_ids.
 * Joins document_versions -> documents to retrieve title.
 */
async function fetchDocumentTitles(
  supabase: SupabaseClient<Database>,
  documentVersionIds: string[],
): Promise<Map<string, string>> {
  if (documentVersionIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("document_versions")
    .select("id, documents!inner(title)")
    .in("id", documentVersionIds);

  if (error) throw new Error(`Failed to fetch document titles: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of data) {
    // document_versions has a FK to documents (many-to-one from the FK-holding side),
    // so Supabase types row.documents as a single object, not an array.
    map.set(row.id, row.documents.title);
  }
  return map;
}

interface ChunkData {
  chunkText: string;
  documentVersionId: string;
  chunkIndex: number;
}

function toRankedList(results: SearchResult[]): RankedResult<ChunkData>[] {
  return results.map((r) => ({
    id: `${r.documentVersionId}:${r.chunkIndex}`,
    data: {
      chunkText: r.chunkText,
      documentVersionId: r.documentVersionId,
      chunkIndex: r.chunkIndex,
    },
  }));
}

/**
 * Run hybrid search for each seed query, merge across queries with RRF,
 * dedupe by documentVersionId:chunkIndex, cap to MAX_FRAGMENTS, and assign
 * each surviving fragment a stable tag (F1..Fn) in merged-rank order.
 *
 * The returned array's index is the canonical tag map:
 *   fragment[0].tag === "F1" -> fragment[0].documentVersionId
 */
export async function retrieveTaggedFragments(
  searchService: SearchService,
  supabase: SupabaseClient<Database>,
  campaignId: string,
  seedQueries: string[],
  options?: { perSeedLimit?: number; maxFragments?: number },
): Promise<TaggedFragment[]> {
  const perSeedLimit = options?.perSeedLimit ?? PER_SEED_LIMIT;
  const maxFragments = options?.maxFragments ?? MAX_FRAGMENTS;

  // Fan-out: run all seed searches concurrently
  const allResultLists = await Promise.all(
    seedQueries.map((q) => searchService.search(q, campaignId, { limit: perSeedLimit })),
  );

  // Convert to ranked lists for RRF
  const rankedLists: RankedResult<ChunkData>[][] = allResultLists.map(toRankedList);

  // Fold all per-seed lists together via successive RRF passes
  let merged = reciprocalRankFusion<ChunkData>(rankedLists[0] ?? [], []);
  for (let i = 1; i < rankedLists.length; i++) {
    const mergedAsRanked: RankedResult<ChunkData>[] = merged.map((r) => ({
      id: r.id,
      data: r.data,
    }));
    merged = reciprocalRankFusion(mergedAsRanked, rankedLists[i] ?? []);
  }

  // Cap to fragment limit
  const capped = merged.slice(0, maxFragments);

  // Fetch document titles for all surviving fragments
  const uniqueVersionIds = [...new Set(capped.map((r) => r.data.documentVersionId))];
  const titleMap = await fetchDocumentTitles(supabase, uniqueVersionIds);

  // Assign tags F1..Fn in merged-rank order
  return capped.map((result, i) => ({
    tag: `F${i + 1}`,
    chunkText: result.data.chunkText,
    documentVersionId: result.data.documentVersionId,
    documentTitle: titleMap.get(result.data.documentVersionId) ?? "Unknown document",
    chunkIndex: result.data.chunkIndex,
  }));
}
