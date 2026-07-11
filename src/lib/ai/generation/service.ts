import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Provider } from "@/lib/ai/providers";
import type { SearchService } from "@/lib/ai/search";
import { buildGenerationSystemPrompt, buildGenerationUserPrompt } from "@/lib/ai/prompts/generation";
import { buildStructuringSystemPrompt, buildStructuringUserPrompt } from "@/lib/ai/prompts/structuring";
import {
  IdeaOutputSchema,
  IdeaOutputJsonSchema,
  ManualIdeaOutputSchema,
  ManualIdeaOutputJsonSchema,
} from "@/lib/ai/prompts/schemas";
import { deriveSeedQueries, retrieveTaggedFragments } from "./retrieval";
import type { TaggedFragment } from "./retrieval";
import { resolveBusinessProfile } from "./profile";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const GENERATION_TEMPERATURE = 0.8;
const GENERATION_MAX_TOKENS = 8192;

export type GenerationProgressPhase = "retrieving" | "generating" | "saving" | "done" | "error";

export interface GenerationProgressEvent {
  type: GenerationProgressPhase;
  /** Populated on "done" with the persisted idea ids. */
  ideaIds?: string[];
  /** Populated on "error". */
  error?: string;
}

interface GenerationServiceDeps {
  provider: Provider;
  searchService: SearchService;
  supabase: SupabaseClient<Database>;
  userId: string;
  campaignId: string;
}

interface CampaignDoc {
  title: string;
  leadText: string;
}

async function fetchCampaignDocuments(supabase: SupabaseClient<Database>, campaignId: string): Promise<CampaignDoc[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("title, content")
    .eq("campaign_id", campaignId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch campaign documents: ${error.message}`);

  return data.map((d) => ({
    title: d.title,
    leadText: d.content.slice(0, 500),
  }));
}

async function fetchCampaignMeta(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<{ title: string; goal: string | null; description: string | null }> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("title, goal, description")
    .eq("id", campaignId)
    .single();

  if (error) throw new Error("Campaign not found");
  return { title: data.title, goal: data.goal, description: data.description };
}

/**
 * Returns the next generation number for a campaign by reading max(generation_number) + 1.
 * Known edge case: two concurrent generate-ideas requests for the same campaign (e.g. two
 * browser tabs) may both read the same max and produce duplicate generation numbers. Ideas
 * are still saved correctly; the UI just groups two batches under the same "Generation #N"
 * heading. Acceptable for current usage — fix with a Postgres RPC if concurrency becomes a concern.
 */
async function autoIncrementGenerationNumber(supabase: SupabaseClient<Database>, campaignId: string): Promise<number> {
  const { data } = await supabase
    .from("ideas")
    .select("generation_number")
    .eq("campaign_id", campaignId)
    .order("generation_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.generation_number ?? 0) + 1;
}

/**
 * Parse JSON from LLM output and strip markdown fences if present.
 */
function stripAndParse(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(stripped) as unknown;
}

/**
 * Parse JSON from the LLM text output and validate against IdeaOutputSchema.
 * Returns null on any parse or validation failure.
 */
function parseAndValidate(text: string) {
  let parsed: unknown;
  try {
    parsed = stripAndParse(text);
  } catch {
    return null;
  }

  const result = IdeaOutputSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Parse JSON from the LLM text output and validate against ManualIdeaOutputSchema.
 * Returns null on any parse or validation failure.
 */
function parseAndValidateManual(text: string) {
  let parsed: unknown;
  try {
    parsed = stripAndParse(text);
  } catch {
    return null;
  }

  const result = ManualIdeaOutputSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Perform a single structured-output LLM call and return the raw text.
 * Pass a custom jsonSchema to override the default IdeaOutputJsonSchema.
 */
async function callLLM(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  jsonSchema: Record<string, unknown> = IdeaOutputJsonSchema,
): Promise<string> {
  const response = await provider.generate({
    model,
    instructions: systemPrompt,
    input: [{ type: "message", role: "user", content: userPrompt }],
    temperature: GENERATION_TEMPERATURE,
    maxTokens: GENERATION_MAX_TOKENS,
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "idea_output",
        strict: true,
        schema: jsonSchema,
      },
    },
  });

  const textItem = response.output.find((o) => o.type === "text");
  if (!textItem) {
    throw new Error("LLM returned no text output");
  }
  return textItem.text;
}

/**
 * Persist ideas and fragment references server-side.
 * Returns the list of inserted idea ids.
 */
export async function persistIdeas(
  supabase: SupabaseClient<Database>,
  campaignId: string,
  userId: string,
  generationNumber: number,
  ideas: ReturnType<typeof IdeaOutputSchema.parse>["ideas"],
  tagMap: Map<string, string>,
): Promise<string[]> {
  const ideaIds: string[] = [];

  for (const idea of ideas) {
    // Resolve tags -> documentVersionId before inserting the idea row.
    // Skip ideas whose source_references all resolve to unmatched tags — those
    // would otherwise be inserted as orphans with no traceable fragment links.
    const resolvedRefs = idea.source_references
      .map((ref) => {
        const documentVersionId = tagMap.get(ref.tag) ?? null;
        if (!documentVersionId) return null; // Drop unmatched tags silently
        return { document_version_id: documentVersionId, quote_snippet: ref.quote_snippet };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (resolvedRefs.length === 0) {
      continue; // All tags hallucinated — do not persist this idea
    }

    const { data: insertedIdea, error: ideaError } = await supabase
      .from("ideas")
      .insert({
        campaign_id: campaignId,
        user_id: userId,
        generation_number: generationNumber,
        source: "auto",
        status: "draft",
        working_title: idea.working_title,
        hook: idea.hook ?? null,
        key_points: idea.key_points ?? null,
        key_quotes: idea.key_quotes,
        proposed_flow: idea.proposed_flow ?? null,
        insights_conclusions: idea.insights_conclusions ?? null,
        call_to_action: idea.call_to_action ?? null,
        storytelling_angle: idea.storytelling_angle ?? null,
        target_audience_note: idea.target_audience_note ?? null,
        content_format_suggestion: idea.content_format_suggestion ?? null,
      })
      .select("id")
      .single();

    if (ideaError) {
      throw new Error(`Failed to insert idea "${idea.working_title}": ${ideaError.message}`);
    }

    ideaIds.push(insertedIdea.id);

    // Batch-insert all resolved refs in one round-trip
    const refsToInsert = resolvedRefs.map((r) => ({ idea_id: insertedIdea.id, ...r }));
    const { error: refError } = await supabase.from("idea_fragment_references").insert(refsToInsert);
    if (refError) {
      throw new Error(`Failed to insert fragment references: ${refError.message}`);
    }
  }

  return ideaIds;
}

/**
 * Persist a single manually structured idea and its fragment references.
 * Unlike persistIdeas, this never skips ideas with zero resolved refs.
 * Returns the inserted idea id.
 */
export async function persistManualIdea(
  supabase: SupabaseClient<Database>,
  campaignId: string,
  userId: string,
  generationNumber: number,
  idea: ReturnType<typeof ManualIdeaOutputSchema.parse>["idea"],
  tagMap: Map<string, string>,
  originalDescription: string,
): Promise<string> {
  const resolvedRefs = idea.source_references
    .map((ref) => {
      const documentVersionId = tagMap.get(ref.tag) ?? null;
      if (!documentVersionId) return null;
      return { document_version_id: documentVersionId, quote_snippet: ref.quote_snippet };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const { data: insertedIdea, error: ideaError } = await supabase
    .from("ideas")
    .insert({
      campaign_id: campaignId,
      user_id: userId,
      generation_number: generationNumber,
      source: "manual",
      original_description: originalDescription,
      status: "draft",
      working_title: idea.working_title,
      hook: idea.hook ?? null,
      key_points: idea.key_points ?? null,
      key_quotes: idea.key_quotes,
      proposed_flow: idea.proposed_flow ?? null,
      insights_conclusions: idea.insights_conclusions ?? null,
      call_to_action: idea.call_to_action ?? null,
      storytelling_angle: idea.storytelling_angle ?? null,
      target_audience_note: idea.target_audience_note ?? null,
      content_format_suggestion: idea.content_format_suggestion ?? null,
    })
    .select("id")
    .single();

  if (ideaError) {
    throw new Error(`Failed to insert manual idea "${idea.working_title}": ${ideaError.message}`);
  }

  if (resolvedRefs.length > 0) {
    const refsToInsert = resolvedRefs.map((r) => ({ idea_id: insertedIdea.id, ...r }));
    const { error: refError } = await supabase.from("idea_fragment_references").insert(refsToInsert);
    if (refError) {
      throw new Error(`Failed to insert fragment references: ${refError.message}`);
    }
  }

  return insertedIdea.id;
}

/**
 * Create the deterministic generation service.
 * Call once per request; `run()` is an async generator that yields coarse progress events.
 */
export function createGenerationService(deps: GenerationServiceDeps) {
  const { provider, searchService, supabase, userId, campaignId } = deps;

  async function* run(params: {
    batchSize: number;
    model?: string;
    bgOpId: string;
  }): AsyncGenerator<GenerationProgressEvent> {
    const model = params.model ?? DEFAULT_MODEL;

    try {
      // ── Step 1: Fetch campaign meta + documents ──────────────────────────────
      yield { type: "retrieving" };

      const [campaign, documents] = await Promise.all([
        fetchCampaignMeta(supabase, campaignId),
        fetchCampaignDocuments(supabase, campaignId),
      ]);

      // ── Step 2: Derive seed queries ──────────────────────────────────────────
      const seedQueries = deriveSeedQueries({
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
        campaignDescription: campaign.description,
        documents,
      });

      // ── Step 3: Retrieve tagged fragments ───────────────────────────────────
      let fragments: TaggedFragment[] = [];
      if (seedQueries.length > 0) {
        fragments = await retrieveTaggedFragments(searchService, supabase, campaignId, seedQueries);
      }

      // Build tag -> documentVersionId map for persistence
      const tagMap = new Map<string, string>(fragments.map((f) => [f.tag, f.documentVersionId]));

      // ── Step 4: Resolve business profile ────────────────────────────────────
      const profile = await resolveBusinessProfile(supabase, userId);

      // Store debug info in background_operations.input_ref
      await supabase
        .from("background_operations")
        .update({
          input_ref: {
            campaign_id: campaignId,
            seed_queries: seedQueries,
            fragment_count: fragments.length,
            tag_map: Object.fromEntries(tagMap),
          },
        })
        .eq("id", params.bgOpId);

      // ── Step 5: Build prompts ────────────────────────────────────────────────
      const systemPrompt = buildGenerationSystemPrompt(profile);
      const userPrompt = buildGenerationUserPrompt({
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
        campaignDescription: campaign.description,
        batchSize: params.batchSize,
        fragments,
      });

      // ── Step 6: Single structured-output LLM call (with one auto-retry) ─────
      yield { type: "generating" };

      let rawText: string;
      try {
        rawText = await callLLM(provider, systemPrompt, userPrompt, model);
      } catch (err) {
        throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Step 7: Validate output (retry once on failure) ──────────────────────
      let parsed = parseAndValidate(rawText);
      if (!parsed) {
        try {
          rawText = await callLLM(provider, systemPrompt, userPrompt, model);
        } catch (err) {
          throw new Error(`LLM retry failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        parsed = parseAndValidate(rawText);
        if (!parsed) {
          throw new Error("LLM output failed schema validation after retry");
        }
      }

      // ── Step 8: Persist ideas + fragment references ──────────────────────────
      yield { type: "saving" };

      const generationNumber = await autoIncrementGenerationNumber(supabase, campaignId);
      const ideaIds = await persistIdeas(supabase, campaignId, userId, generationNumber, parsed.ideas, tagMap);

      // ── Step 9: Done ─────────────────────────────────────────────────────────
      yield { type: "done", ideaIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      yield { type: "error", error: message };
    }
  }

  return { run };
}

/**
 * Create the manual idea structuring service.
 * Uses the user's description as the primary seed query; produces a single idea
 * persisted with source: "manual" and original_description populated.
 */
export function createStructuringService(deps: GenerationServiceDeps) {
  const { provider, searchService, supabase, userId, campaignId } = deps;

  async function* run(params: {
    description: string;
    model?: string;
    bgOpId: string;
  }): AsyncGenerator<GenerationProgressEvent> {
    const model = params.model ?? DEFAULT_MODEL;

    try {
      // ── Step 1: Fetch campaign meta ──────────────────────────────────────────
      yield { type: "retrieving" };

      const campaign = await fetchCampaignMeta(supabase, campaignId);

      // ── Step 2: Use description as the single seed query ─────────────────────
      const seedQuery = params.description;

      // ── Step 3: Retrieve tagged fragments ───────────────────────────────────
      const fragments = await retrieveTaggedFragments(searchService, supabase, campaignId, [seedQuery]);
      const tagMap = new Map<string, string>(fragments.map((f) => [f.tag, f.documentVersionId]));

      // ── Step 4: Resolve business profile ────────────────────────────────────
      const profile = await resolveBusinessProfile(supabase, userId);

      // Store debug info in background_operations.input_ref
      await supabase
        .from("background_operations")
        .update({
          input_ref: {
            campaign_id: campaignId,
            description: params.description,
            fragment_count: fragments.length,
            tag_map: Object.fromEntries(tagMap),
          },
        })
        .eq("id", params.bgOpId);

      // ── Step 5: Build structuring prompts ────────────────────────────────────
      const systemPrompt = buildStructuringSystemPrompt(profile);
      const userPrompt = buildStructuringUserPrompt({
        description: params.description,
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
        campaignDescription: campaign.description,
        fragments,
      });

      // ── Step 6: Single structured-output LLM call (with one auto-retry) ─────
      yield { type: "generating" };

      let rawText: string;
      try {
        rawText = await callLLM(provider, systemPrompt, userPrompt, model, ManualIdeaOutputJsonSchema);
      } catch (err) {
        throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Step 7: Validate output (retry once on failure) ──────────────────────
      let parsed = parseAndValidateManual(rawText);
      if (!parsed) {
        try {
          rawText = await callLLM(provider, systemPrompt, userPrompt, model, ManualIdeaOutputJsonSchema);
        } catch (err) {
          throw new Error(`LLM retry failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        parsed = parseAndValidateManual(rawText);
        if (!parsed) {
          throw new Error("LLM output failed schema validation after retry");
        }
      }

      // ── Step 8: Persist manual idea + fragment references ────────────────────
      yield { type: "saving" };

      const generationNumber = await autoIncrementGenerationNumber(supabase, campaignId);
      const ideaId = await persistManualIdea(
        supabase,
        campaignId,
        userId,
        generationNumber,
        parsed.idea,
        tagMap,
        params.description,
      );

      // ── Step 9: Done ─────────────────────────────────────────────────────────
      yield { type: "done", ideaIds: [ideaId] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Structuring failed";
      yield { type: "error", error: message };
    }
  }

  return { run };
}
