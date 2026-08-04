import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Provider } from "@/lib/ai/providers";
import type { SearchService } from "@/lib/ai/search";
import { buildGenerationSystemPrompt, buildGenerationUserPrompt } from "@/lib/ai/prompts/generation";
import { buildStructuringSystemPrompt, buildStructuringUserPrompt } from "@/lib/ai/prompts/structuring";
import { buildRegenerationSystemPrompt, buildRegenerationUserPrompt } from "@/lib/ai/prompts/regeneration";
import type { OriginalIdeaForPrompt } from "@/lib/ai/prompts/regeneration";
import {
  IdeaOutputSchema,
  IdeaOutputJsonSchema,
  ManualIdeaOutputSchema,
  ManualIdeaOutputJsonSchema,
} from "@/lib/ai/prompts/schemas";
import { deriveSeedQueries, retrieveTaggedFragments } from "./retrieval";
import { jsonrepair } from "jsonrepair";
import type { TaggedFragment } from "./retrieval";
import { resolveBusinessProfile } from "./profile";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const GENERATION_TEMPERATURE = 0.8;
const GENERATION_MAX_TOKENS = 8192;

const LOG_PREFIX = "[gen-svc]";

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
 * Falls back to `jsonrepair` when `JSON.parse` fails — this handles unescaped
 * double quotes that Anthropic models produce in non-English text (e.g. Polish
 * „…" quotation marks where the closing quote is an ASCII " that breaks JSON).
 */
function stripAndParse(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    console.info(LOG_PREFIX, "JSON.parse failed, attempting jsonrepair");
    const repaired = jsonrepair(stripped);
    return JSON.parse(repaired) as unknown;
  }
}

type ParseResult<T> = { success: true; data: T } | { success: false; reason: string };

/**
 * Parse JSON from the LLM text output and validate against IdeaOutputSchema.
 * Returns a discriminated result with diagnostic info on failure.
 */
function parseAndValidate(text: string): ParseResult<ReturnType<typeof IdeaOutputSchema.parse>> {
  let parsed: unknown;
  try {
    parsed = stripAndParse(text);
  } catch (err) {
    const preview = text.slice(0, 500);
    const reason = `JSON parse failed: ${err instanceof Error ? err.message : String(err)} | raw start: ${preview}`;
    console.info(LOG_PREFIX, "parseAndValidate failed", { stage: "json_parse", reason, rawLength: text.length });
    return { success: false, reason };
  }

  const result = IdeaOutputSchema.safeParse(parsed);
  if (result.success) {
    console.info(LOG_PREFIX, "parseAndValidate success", { ideaCount: result.data.ideas.length });
    return { success: true, data: result.data };
  }

  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  const reason = `Zod validation failed: ${issues}`;
  console.info(LOG_PREFIX, "parseAndValidate failed", {
    stage: "zod_validation",
    reason,
    issueCount: result.error.issues.length,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })),
    parsedKeys: typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : "not_object",
  });
  return { success: false, reason };
}

/**
 * Parse JSON from the LLM text output and validate against ManualIdeaOutputSchema.
 * Returns a discriminated result with diagnostic info on failure.
 */
function parseAndValidateManual(text: string): ParseResult<ReturnType<typeof ManualIdeaOutputSchema.parse>> {
  let parsed: unknown;
  try {
    parsed = stripAndParse(text);
  } catch (err) {
    const preview = text.slice(0, 500);
    const reason = `JSON parse failed: ${err instanceof Error ? err.message : String(err)} | raw start: ${preview}`;
    console.info(LOG_PREFIX, "parseAndValidateManual failed", { stage: "json_parse", reason, rawLength: text.length });
    return { success: false, reason };
  }

  const result = ManualIdeaOutputSchema.safeParse(parsed);
  if (result.success) {
    console.info(LOG_PREFIX, "parseAndValidateManual success", { title: result.data.idea.working_title });
    return { success: true, data: result.data };
  }

  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  const reason = `Zod validation failed: ${issues}`;
  console.info(LOG_PREFIX, "parseAndValidateManual failed", {
    stage: "zod_validation",
    reason,
    issueCount: result.error.issues.length,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })),
    parsedKeys: typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : "not_object",
  });
  return { success: false, reason };
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
  console.info(LOG_PREFIX, "callLLM request", {
    model,
    temperature: GENERATION_TEMPERATURE,
    maxTokens: GENERATION_MAX_TOKENS,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    jsonSchemaKeys: Object.keys(jsonSchema),
    responseFormatType: "json_schema",
    strict: true,
  });

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

  console.info(LOG_PREFIX, "callLLM response", {
    id: response.id,
    model: response.model,
    finishReason: response.finishReason,
    usage: response.usage,
    outputItemTypes: response.output.map((o) => o.type),
    outputItemCount: response.output.length,
  });

  const textItem = response.output.find((o) => o.type === "text");
  if (!textItem) {
    console.info(LOG_PREFIX, "callLLM no text output", {
      outputItems: response.output.map((o) => ({ type: o.type })),
    });
    throw new Error("LLM returned no text output");
  }

  console.info(LOG_PREFIX, "callLLM raw text", {
    textLength: textItem.text.length,
    textStart: textItem.text.slice(0, 300),
    textEnd: textItem.text.slice(-200),
  });

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
  improvementHint?: string,
): Promise<string[]> {
  console.info(LOG_PREFIX, "persistIdeas:start", {
    campaignId,
    generationNumber,
    ideaCount: ideas.length,
    tagMapSize: tagMap.size,
    tagMapKeys: [...tagMap.keys()],
    hasImprovementHint: !!improvementHint,
  });

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

    if (resolvedRefs.length === 0 && idea.source_references.length > 0) {
      // Ideas with source_references that ALL resolve to unknown tags are hallucinated — skip.
      // Ideas with no source_references at all (no fragments available) are valid — let through.
      console.info(LOG_PREFIX, "persistIdeas:skipped (all tags unmatched)", {
        title: idea.working_title,
        requestedTags: idea.source_references.map((r) => r.tag),
      });
      continue;
    }

    console.info(LOG_PREFIX, "persistIdeas:inserting", {
      title: idea.working_title,
      resolvedRefCount: resolvedRefs.length,
      totalRefCount: idea.source_references.length,
      unmatchedTags: idea.source_references.filter((r) => !tagMap.has(r.tag)).map((r) => r.tag),
    });

    const { data: insertedIdea, error: ideaError } = await supabase
      .from("ideas")
      .insert({
        campaign_id: campaignId,
        user_id: userId,
        generation_number: generationNumber,
        source: "auto",
        status: "draft",
        improvement_hint: improvementHint ?? null,
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

    console.info(LOG_PREFIX, "generation:start", {
      campaignId,
      userId,
      batchSize: params.batchSize,
      model,
      bgOpId: params.bgOpId,
    });

    try {
      // ── Step 1: Fetch campaign meta + documents ──────────────────────────────
      yield { type: "retrieving" };

      const [campaign, documents] = await Promise.all([
        fetchCampaignMeta(supabase, campaignId),
        fetchCampaignDocuments(supabase, campaignId),
      ]);

      console.info(LOG_PREFIX, "generation:step1 campaign+docs fetched", {
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
        documentCount: documents.length,
        documentTitles: documents.map((d) => d.title),
      });

      // ── Step 2: Derive seed queries ──────────────────────────────────────────
      const seedQueries = deriveSeedQueries({
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
        campaignDescription: campaign.description,
        documents,
      });

      console.info(LOG_PREFIX, "generation:step2 seed queries", {
        seedQueryCount: seedQueries.length,
        seedQueries,
      });

      // ── Step 3: Retrieve tagged fragments ───────────────────────────────────
      let fragments: TaggedFragment[] = [];
      if (seedQueries.length > 0) {
        fragments = await retrieveTaggedFragments(searchService, supabase, campaignId, seedQueries);
      }

      // Build tag -> documentVersionId map for persistence
      const tagMap = new Map<string, string>(fragments.map((f) => [f.tag, f.documentVersionId]));

      console.info(LOG_PREFIX, "generation:step3 fragments retrieved", {
        fragmentCount: fragments.length,
        tags: fragments.map((f) => f.tag),
        tagMapSize: tagMap.size,
        fragmentPreviews: fragments.map((f) => ({
          tag: f.tag,
          documentTitle: f.documentTitle,
          chunkTextLength: f.chunkText.length,
        })),
      });

      // ── Step 4: Resolve business profile ────────────────────────────────────
      const profile = await resolveBusinessProfile(supabase, userId);

      console.info(LOG_PREFIX, "generation:step4 profile resolved", {
        toneOfVoice: profile.toneOfVoice,
        audience: profile.audience,
        brandGoal: profile.brandGoal,
        archetype: profile.archetype,
        keywordCount: profile.keywords.length,
      });

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

      console.info(LOG_PREFIX, "generation:step5 prompts built", {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
      });

      // ── Step 6: Single structured-output LLM call (with one auto-retry) ─────
      yield { type: "generating" };

      console.info(LOG_PREFIX, "generation:step6 calling LLM (attempt 1)");

      let rawText: string;
      try {
        rawText = await callLLM(provider, systemPrompt, userPrompt, model);
      } catch (err) {
        console.info(LOG_PREFIX, "generation:step6 LLM call failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Step 7: Validate output (retry once on failure) ──────────────────────
      console.info(LOG_PREFIX, "generation:step7 validating output (attempt 1)");
      let result = parseAndValidate(rawText);
      if (!result.success) {
        const firstReason = result.reason;
        console.info(LOG_PREFIX, "generation:step7 validation failed, retrying LLM (attempt 2)", {
          firstReason,
        });
        try {
          rawText = await callLLM(provider, systemPrompt, userPrompt, model);
        } catch (err) {
          throw new Error(
            `LLM retry failed (first attempt: ${firstReason}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        result = parseAndValidate(rawText);
        if (!result.success) {
          throw new Error(
            `LLM output failed schema validation after retry. Attempt 1: ${firstReason} | Attempt 2: ${result.reason}`,
          );
        }
      }

      console.info(LOG_PREFIX, "generation:step7 validation passed", {
        ideaCount: result.data.ideas.length,
        ideaTitles: result.data.ideas.map((i) => i.working_title),
        ideaRefCounts: result.data.ideas.map((i) => ({
          title: i.working_title,
          sourceRefs: i.source_references.length,
          keyQuotes: i.key_quotes.length,
          tags: i.source_references.map((r) => r.tag),
        })),
      });

      // ── Step 8: Persist ideas + fragment references ──────────────────────────
      yield { type: "saving" };

      const generationNumber = await autoIncrementGenerationNumber(supabase, campaignId);
      console.info(LOG_PREFIX, "generation:step8 persisting", {
        generationNumber,
        ideaCount: result.data.ideas.length,
      });

      const ideaIds = await persistIdeas(supabase, campaignId, userId, generationNumber, result.data.ideas, tagMap);

      console.info(LOG_PREFIX, "generation:step8 persisted", {
        ideaIdCount: ideaIds.length,
        ideaIds,
      });

      // ── Step 9: Done ─────────────────────────────────────────────────────────
      console.info(LOG_PREFIX, "generation:done", { ideaIds });
      yield { type: "done", ideaIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      console.info(LOG_PREFIX, "generation:error", {
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
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

    console.info(LOG_PREFIX, "structuring:start", {
      campaignId,
      userId,
      descriptionLength: params.description.length,
      model,
      bgOpId: params.bgOpId,
    });

    try {
      // ── Step 1: Fetch campaign meta ──────────────────────────────────────────
      yield { type: "retrieving" };

      const campaign = await fetchCampaignMeta(supabase, campaignId);

      console.info(LOG_PREFIX, "structuring:step1 campaign fetched", {
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
      });

      // ── Step 2: Use description as the single seed query ─────────────────────
      const seedQuery = params.description;

      // ── Step 3: Retrieve tagged fragments ───────────────────────────────────
      const fragments = await retrieveTaggedFragments(searchService, supabase, campaignId, [seedQuery]);
      const tagMap = new Map<string, string>(fragments.map((f) => [f.tag, f.documentVersionId]));

      console.info(LOG_PREFIX, "structuring:step3 fragments retrieved", {
        fragmentCount: fragments.length,
        tags: fragments.map((f) => f.tag),
      });

      // ── Step 4: Resolve business profile ────────────────────────────────────
      const profile = await resolveBusinessProfile(supabase, userId);

      console.info(LOG_PREFIX, "structuring:step4 profile resolved", {
        toneOfVoice: profile.toneOfVoice,
        archetype: profile.archetype,
      });

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

      console.info(LOG_PREFIX, "structuring:step5 prompts built", {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
      });

      // ── Step 6: Single structured-output LLM call (with one auto-retry) ─────
      yield { type: "generating" };

      console.info(LOG_PREFIX, "structuring:step6 calling LLM (attempt 1)");

      let rawText: string;
      try {
        rawText = await callLLM(provider, systemPrompt, userPrompt, model, ManualIdeaOutputJsonSchema);
      } catch (err) {
        console.info(LOG_PREFIX, "structuring:step6 LLM call failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Step 7: Validate output (retry once on failure) ──────────────────────
      console.info(LOG_PREFIX, "structuring:step7 validating output (attempt 1)");
      let manualResult = parseAndValidateManual(rawText);
      if (!manualResult.success) {
        const firstReason = manualResult.reason;
        console.info(LOG_PREFIX, "structuring:step7 validation failed, retrying LLM (attempt 2)", {
          firstReason,
        });
        try {
          rawText = await callLLM(provider, systemPrompt, userPrompt, model, ManualIdeaOutputJsonSchema);
        } catch (err) {
          throw new Error(
            `LLM retry failed (first attempt: ${firstReason}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        manualResult = parseAndValidateManual(rawText);
        if (!manualResult.success) {
          throw new Error(
            `LLM output failed schema validation after retry. Attempt 1: ${firstReason} | Attempt 2: ${manualResult.reason}`,
          );
        }
      }

      console.info(LOG_PREFIX, "structuring:step7 validation passed", {
        title: manualResult.data.idea.working_title,
        refCount: manualResult.data.idea.source_references.length,
      });

      // ── Step 8: Persist manual idea + fragment references ────────────────────
      yield { type: "saving" };

      const generationNumber = await autoIncrementGenerationNumber(supabase, campaignId);
      console.info(LOG_PREFIX, "structuring:step8 persisting", { generationNumber });

      const ideaId = await persistManualIdea(
        supabase,
        campaignId,
        userId,
        generationNumber,
        manualResult.data.idea,
        tagMap,
        params.description,
      );

      console.info(LOG_PREFIX, "structuring:done", { ideaId });

      // ── Step 9: Done ─────────────────────────────────────────────────────────
      yield { type: "done", ideaIds: [ideaId] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Structuring failed";
      console.info(LOG_PREFIX, "structuring:error", {
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      yield { type: "error", error: message };
    }
  }

  return { run };
}

/**
 * Fetch original ideas for regeneration: all ideas matching campaignId + generationNumber,
 * optionally filtered to a single idea by ideaId.
 * Returns the data in the shape needed by the regeneration prompt.
 */
async function fetchSourceIdeasForRegeneration(
  supabase: SupabaseClient<Database>,
  campaignId: string,
  generationNumber: number,
  ideaId?: string,
): Promise<OriginalIdeaForPrompt[]> {
  let query = supabase
    .from("ideas")
    .select(
      "id, working_title, hook, key_points, key_quotes, proposed_flow, insights_conclusions, call_to_action, storytelling_angle, target_audience_note, content_format_suggestion",
    )
    .eq("campaign_id", campaignId)
    .eq("generation_number", generationNumber)
    .order("created_at", { ascending: true });

  if (ideaId) {
    query = query.eq("id", ideaId);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch source ideas: ${error.message}`);

  return data.map((idea) => ({
    working_title: idea.working_title,
    hook: idea.hook,
    key_points: idea.key_points,
    key_quotes: idea.key_quotes,
    proposed_flow: idea.proposed_flow,
    insights_conclusions: idea.insights_conclusions,
    call_to_action: idea.call_to_action,
    storytelling_angle: idea.storytelling_angle,
    target_audience_note: idea.target_audience_note,
    content_format_suggestion: idea.content_format_suggestion,
  }));
}

/**
 * Derive seed queries from the original ideas' content.
 * Uses working_title + hook + first few key_points from each idea as retrieval anchors.
 */
function deriveRegenerationSeedQueries(ideas: OriginalIdeaForPrompt[]): string[] {
  const queries: string[] = [];

  for (const idea of ideas) {
    const parts: string[] = [idea.working_title];
    if (idea.hook) parts.push(idea.hook);
    if (idea.key_points && idea.key_points.length > 0) {
      parts.push(idea.key_points.slice(0, 3).join(" "));
    }
    const q = parts.join(" — ").slice(0, 500);
    if (q.trim()) queries.push(q.trim());
  }

  // Dedupe
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
 * Create the regeneration service.
 * Fetches original ideas, retrieves fresh fragments, builds regeneration prompts,
 * and persists new ideas with improvement_hint populated.
 */
export function createRegenerationService(deps: GenerationServiceDeps) {
  const { provider, searchService, supabase, userId, campaignId } = deps;

  async function* run(params: {
    generationNumber: number;
    ideaId?: string;
    hint?: string;
    model?: string;
    bgOpId: string;
  }): AsyncGenerator<GenerationProgressEvent> {
    const model = params.model ?? DEFAULT_MODEL;

    console.info(LOG_PREFIX, "regeneration:start", {
      campaignId,
      userId,
      generationNumber: params.generationNumber,
      ideaId: params.ideaId ?? null,
      hint: params.hint ?? null,
      model,
      bgOpId: params.bgOpId,
    });

    try {
      // ── Step 1: Fetch campaign meta + source ideas ──────────────────────────
      yield { type: "retrieving" };

      const [campaign, sourceIdeas] = await Promise.all([
        fetchCampaignMeta(supabase, campaignId),
        fetchSourceIdeasForRegeneration(supabase, campaignId, params.generationNumber, params.ideaId),
      ]);

      console.info(LOG_PREFIX, "regeneration:step1 campaign+source ideas fetched", {
        campaignTitle: campaign.title,
        sourceIdeaCount: sourceIdeas.length,
        sourceIdeaTitles: sourceIdeas.map((i) => i.working_title),
      });

      if (sourceIdeas.length === 0) {
        throw new Error("No source ideas found for the given generation number");
      }

      const batchSize = sourceIdeas.length;

      // ── Step 2: Derive seed queries from original ideas ─────────────────────
      const seedQueries = deriveRegenerationSeedQueries(sourceIdeas);

      console.info(LOG_PREFIX, "regeneration:step2 seed queries", {
        seedQueryCount: seedQueries.length,
        seedQueries,
      });

      // ── Step 3: Retrieve tagged fragments ───────────────────────────────────
      let fragments: TaggedFragment[] = [];
      if (seedQueries.length > 0) {
        fragments = await retrieveTaggedFragments(searchService, supabase, campaignId, seedQueries);
      }

      const tagMap = new Map<string, string>(fragments.map((f) => [f.tag, f.documentVersionId]));

      console.info(LOG_PREFIX, "regeneration:step3 fragments retrieved", {
        fragmentCount: fragments.length,
        tags: fragments.map((f) => f.tag),
      });

      // ── Step 4: Resolve business profile ────────────────────────────────────
      const profile = await resolveBusinessProfile(supabase, userId);

      console.info(LOG_PREFIX, "regeneration:step4 profile resolved", {
        toneOfVoice: profile.toneOfVoice,
        archetype: profile.archetype,
      });

      // Store debug info in background_operations.input_ref
      await supabase
        .from("background_operations")
        .update({
          input_ref: {
            campaign_id: campaignId,
            generation_number: params.generationNumber,
            idea_id: params.ideaId ?? null,
            hint: params.hint ?? null,
            seed_queries: seedQueries,
            fragment_count: fragments.length,
            tag_map: Object.fromEntries(tagMap),
          },
        })
        .eq("id", params.bgOpId);

      // ── Step 5: Build regeneration prompts ──────────────────────────────────
      const systemPrompt = buildRegenerationSystemPrompt(profile);
      const userPrompt = buildRegenerationUserPrompt({
        originalIdeas: sourceIdeas,
        campaignTitle: campaign.title,
        campaignGoal: campaign.goal,
        campaignDescription: campaign.description,
        batchSize,
        fragments,
        hint: params.hint,
      });

      console.info(LOG_PREFIX, "regeneration:step5 prompts built", {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        batchSize,
      });

      // ── Step 6: Single structured-output LLM call (with one auto-retry) ─────
      yield { type: "generating" };

      console.info(LOG_PREFIX, "regeneration:step6 calling LLM (attempt 1)");

      let rawText: string;
      try {
        rawText = await callLLM(provider, systemPrompt, userPrompt, model);
      } catch (err) {
        console.info(LOG_PREFIX, "regeneration:step6 LLM call failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Step 7: Validate output (retry once on failure) ──────────────────────
      console.info(LOG_PREFIX, "regeneration:step7 validating output (attempt 1)");
      let regenResult = parseAndValidate(rawText);
      if (!regenResult.success) {
        const firstReason = regenResult.reason;
        console.info(LOG_PREFIX, "regeneration:step7 validation failed, retrying LLM (attempt 2)", {
          firstReason,
        });
        try {
          rawText = await callLLM(provider, systemPrompt, userPrompt, model);
        } catch (err) {
          throw new Error(
            `LLM retry failed (first attempt: ${firstReason}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        regenResult = parseAndValidate(rawText);
        if (!regenResult.success) {
          throw new Error(
            `LLM output failed schema validation after retry. Attempt 1: ${firstReason} | Attempt 2: ${regenResult.reason}`,
          );
        }
      }

      console.info(LOG_PREFIX, "regeneration:step7 validation passed", {
        ideaCount: regenResult.data.ideas.length,
        ideaTitles: regenResult.data.ideas.map((i) => i.working_title),
      });

      // ── Step 8: Persist ideas + fragment references ──────────────────────────
      yield { type: "saving" };

      const generationNumber = await autoIncrementGenerationNumber(supabase, campaignId);
      console.info(LOG_PREFIX, "regeneration:step8 persisting", {
        generationNumber,
        ideaCount: regenResult.data.ideas.length,
      });

      const ideaIds = await persistIdeas(
        supabase,
        campaignId,
        userId,
        generationNumber,
        regenResult.data.ideas,
        tagMap,
        params.hint,
      );

      console.info(LOG_PREFIX, "regeneration:done", { ideaIds });

      // ── Step 9: Done ─────────────────────────────────────────────────────────
      yield { type: "done", ideaIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Regeneration failed";
      console.info(LOG_PREFIX, "regeneration:error", {
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      yield { type: "error", error: message };
    }
  }

  return { run };
}
