export interface RankedResult<T> {
  id: string;
  data: T;
}

export interface RRFResult<T> {
  id: string;
  data: T;
  /** Combined Reciprocal Rank Fusion score. Higher is better. */
  rrfScore: number;
  /** 1-based rank from vector search, or null if not in vector results. */
  vectorRank: number | null;
  /** 1-based rank from FTS, or null if not in FTS results. */
  ftsRank: number | null;
  /** Which search methods matched this result. */
  matchedBy: ("vector" | "fts")[];
}

/**
 * Merge two ranked result lists using Reciprocal Rank Fusion.
 *
 * RRF score for a document at rank r: 1 / (k + r)
 * Documents appearing in both lists accumulate scores from each.
 * Default k=60 is the standard value from the original RRF paper.
 */
export function reciprocalRankFusion<T>(
  vectorResults: RankedResult<T>[],
  ftsResults: RankedResult<T>[],
  k = 60,
): RRFResult<T>[] {
  const scores = new Map<string, RRFResult<T>>();

  // Score vector results (1-indexed)
  let vi = 0;
  for (const result of vectorResults) {
    scores.set(result.id, {
      id: result.id,
      data: result.data,
      rrfScore: 1 / (k + vi + 1),
      vectorRank: vi + 1,
      ftsRank: null,
      matchedBy: ["vector"],
    });
    vi++;
  }

  // Score FTS results and merge with vector scores
  let fi = 0;
  for (const result of ftsResults) {
    const ftsScore = 1 / (k + fi + 1);
    const existing = scores.get(result.id);
    if (existing) {
      existing.rrfScore += ftsScore;
      existing.ftsRank = fi + 1;
      existing.matchedBy = [...existing.matchedBy, "fts"];
    } else {
      scores.set(result.id, {
        id: result.id,
        data: result.data,
        rrfScore: ftsScore,
        vectorRank: null,
        ftsRank: fi + 1,
        matchedBy: ["fts"],
      });
    }
    fi++;
  }

  return Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}
