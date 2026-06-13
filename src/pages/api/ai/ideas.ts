import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { IdeaSchema } from "@/lib/ai/prompts";

const BodySchema = z.object({
  campaign_id: z.uuid(),
  generation_number: z.number().int().positive().optional(),
  ideas: z.array(IdeaSchema).min(1),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("Database not configured", 503);
  }

  // Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = (await context.request.json()) as unknown;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(`Invalid request: ${parsed.error.message}`, 400);
  }

  const { campaign_id, ideas } = parsed.data;
  let { generation_number } = parsed.data;

  // Verify campaign ownership
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return jsonError("Campaign not found or access denied", 403);
  }

  // Auto-determine generation_number if not provided
  if (generation_number === undefined) {
    const { data: maxRow } = await supabase
      .from("ideas")
      .select("generation_number")
      .eq("campaign_id", campaign_id)
      .order("generation_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    generation_number = (maxRow?.generation_number ?? 0) + 1;
  }

  const idea_ids: string[] = [];

  for (const idea of ideas) {
    // Insert the idea row
    const { data: insertedIdea, error: ideaError } = await supabase
      .from("ideas")
      .insert({
        campaign_id,
        user_id: user.id,
        generation_number,
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
      return jsonError(`Failed to insert idea "${idea.working_title}": ${ideaError.message}`, 500);
    }

    idea_ids.push(insertedIdea.id);

    // Resolve and insert fragment references
    for (const ref of idea.source_references) {
      let resolvedVersionId: string | null = null;

      if (ref.document_version_id) {
        // Validate the echoed ID belongs to a document in this campaign
        const { data: versionRow } = await supabase
          .from("document_versions")
          .select("id, documents!inner(campaign_id)")
          .eq("id", ref.document_version_id)
          .maybeSingle();

        // document_versions joins documents via document_id; we need to verify campaign_id
        // The join above returns an object; check the nested campaign_id
        const docRow = versionRow as {
          id: string;
          documents: { campaign_id: string } | { campaign_id: string }[];
        } | null;
        const nestedDoc = docRow?.documents;
        const docCampaignId = Array.isArray(nestedDoc) ? nestedDoc[0]?.campaign_id : nestedDoc?.campaign_id;

        if (docRow && docCampaignId === campaign_id) {
          resolvedVersionId = docRow.id;
        }
        // If validation fails, fall through to title-based lookup
      }

      if (!resolvedVersionId && ref.document_title) {
        // Fall back: match by document title in this campaign, take the latest version
        const { data: docRow } = await supabase
          .from("documents")
          .select("id")
          .eq("campaign_id", campaign_id)
          .eq("title", ref.document_title)
          .maybeSingle();

        if (docRow) {
          const { data: latestVersion } = await supabase
            .from("document_versions")
            .select("id")
            .eq("document_id", docRow.id)
            .order("version_number", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestVersion) {
            resolvedVersionId = latestVersion.id;
          }
        }
      }

      // Insert fragment reference (document_version_id may be null if unresolved)
      await supabase.from("idea_fragment_references").insert({
        idea_id: insertedIdea.id,
        document_version_id: resolvedVersionId,
        quote_snippet: ref.quote_snippet,
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, idea_ids }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
