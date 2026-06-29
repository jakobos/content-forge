import { describe, it, expect, vi, beforeEach } from "vitest";
import { persistIdeas } from "./service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// ---------------------------------------------------------------------------
// Minimal idea fixture helpers
// ---------------------------------------------------------------------------

function makeIdea(title: string, tags: string[]) {
  return {
    working_title: title,
    hook: null,
    key_points: null,
    key_quotes: ["quote"],
    proposed_flow: null,
    insights_conclusions: null,
    call_to_action: null,
    storytelling_angle: null,
    target_audience_note: null,
    content_format_suggestion: null,
    source_references: tags.map((tag) => ({ tag, quote_snippet: `snippet for ${tag}` })),
  };
}

// ---------------------------------------------------------------------------
// Supabase mock factory
//
// Tracks inserts by table name so tests can assert on what was persisted.
// Supports the two chained call patterns used by persistIdeas:
//   ideas:                  .from().insert().select().single()  → { data, error }
//   idea_fragment_references: .from().insert()                  → { error }
// ---------------------------------------------------------------------------

function makeMockSupabase(opts: { ideasError?: { message: string } } = {}) {
  const insertedIdeas: unknown[] = [];
  const insertedRefs: unknown[] = [];

  let idCounter = 0;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "ideas") {
        return {
          insert: vi.fn((row: unknown) => {
            insertedIdeas.push(row);
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => {
                  if (opts.ideasError) {
                    return Promise.resolve({ data: null, error: opts.ideasError });
                  }
                  return Promise.resolve({ data: { id: `idea-${++idCounter}` }, error: null });
                }),
              })),
            };
          }),
        };
      }

      if (table === "idea_fragment_references") {
        return {
          insert: vi.fn((rows: unknown) => {
            (rows as unknown[]).forEach((r) => insertedRefs.push(r));
            return Promise.resolve({ error: null });
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    _insertedIdeas: insertedIdeas,
    _insertedRefs: insertedRefs,
  };

  return supabase as unknown as SupabaseClient<Database> & {
    _insertedIdeas: unknown[];
    _insertedRefs: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistIdeas", () => {
  const CAMPAIGN_ID = "campaign-1";
  const USER_ID = "user-1";
  const GENERATION_NUMBER = 1;

  let tagMap: Map<string, string>;

  beforeEach(() => {
    tagMap = new Map([
      ["F1", "doc-version-1"],
      ["F2", "doc-version-2"],
    ]);
  });

  it("all tags valid — persists idea and refs, returns idea ID", async () => {
    const supabase = makeMockSupabase();
    const ideas = [makeIdea("Idea A", ["F1"])];

    const ids = await persistIdeas(supabase, CAMPAIGN_ID, USER_ID, GENERATION_NUMBER, ideas, tagMap);

    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("idea-1");
    expect(supabase._insertedIdeas).toHaveLength(1);
    expect(supabase._insertedRefs).toHaveLength(1);
    expect(supabase._insertedRefs[0]).toMatchObject({
      idea_id: "idea-1",
      document_version_id: "doc-version-1",
      quote_snippet: "snippet for F1",
    });
  });

  it("some tags valid, some not — persists idea with only matched refs", async () => {
    const supabase = makeMockSupabase();
    const ideas = [makeIdea("Idea B", ["F1", "F99"])];

    const ids = await persistIdeas(supabase, CAMPAIGN_ID, USER_ID, GENERATION_NUMBER, ideas, tagMap);

    expect(ids).toHaveLength(1);
    expect(supabase._insertedIdeas).toHaveLength(1);
    // Only F1 ref inserted; F99 silently dropped
    expect(supabase._insertedRefs).toHaveLength(1);
    expect(supabase._insertedRefs[0]).toMatchObject({ document_version_id: "doc-version-1" });
  });

  it("all tags invalid — idea is NOT inserted, returns empty array", async () => {
    const supabase = makeMockSupabase();
    const ideas = [makeIdea("Orphan Idea", ["F99"])];

    const ids = await persistIdeas(supabase, CAMPAIGN_ID, USER_ID, GENERATION_NUMBER, ideas, tagMap);

    expect(ids).toHaveLength(0);
    expect(supabase._insertedIdeas).toHaveLength(0);
    expect(supabase._insertedRefs).toHaveLength(0);
  });

  it("mixed batch — only grounded ideas are persisted", async () => {
    const supabase = makeMockSupabase();
    const ideas = [
      makeIdea("Valid", ["F1"]), // grounded
      makeIdea("Orphan", ["F99"]), // all-invalid → skipped
      makeIdea("Partial", ["F2", "F88"]), // partial → persisted
    ];

    const ids = await persistIdeas(supabase, CAMPAIGN_ID, USER_ID, GENERATION_NUMBER, ideas, tagMap);

    expect(ids).toHaveLength(2);
    expect(supabase._insertedIdeas).toHaveLength(2);
    // Valid: 1 ref (F1); Partial: 1 ref (F2, F88 dropped)
    expect(supabase._insertedRefs).toHaveLength(2);
  });

  it("Supabase insert error — throws with working_title in message", async () => {
    const supabase = makeMockSupabase({ ideasError: { message: "db down" } });
    const ideas = [makeIdea("Failing Idea", ["F1"])];

    await expect(persistIdeas(supabase, CAMPAIGN_ID, USER_ID, GENERATION_NUMBER, ideas, tagMap)).rejects.toThrow(
      'Failed to insert idea "Failing Idea"',
    );
  });
});
