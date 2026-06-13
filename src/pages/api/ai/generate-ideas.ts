import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { initializeAI } from "@/lib/ai";
import { createSSEResponse } from "@/lib/ai/streaming";
import type { GenerationProgressEvent } from "@/lib/ai/generation/service";

const BodySchema = z.object({
  campaign_id: z.uuid(),
  batch_size: z.number().int().min(1).max(10).default(5),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  if (!OPENROUTER_API_KEY) {
    return jsonError("AI not configured", 503);
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
    return jsonError(`Invalid request: ${parsed.error.issues[0]?.message ?? "bad input"}`, 400);
  }
  const { campaign_id, batch_size } = parsed.data;

  // Verify campaign ownership
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (campaignError) {
    return jsonError("Database error verifying campaign", 500);
  }
  if (!campaign) {
    return jsonError("Campaign not found or access denied", 403);
  }

  // Create background_operations row
  const { data: bgOp, error: bgOpError } = await supabase
    .from("background_operations")
    .insert({
      user_id: user.id,
      type: "idea_generation",
      status: "pending",
      input_ref: { campaign_id },
    })
    .select("id")
    .single();

  if (bgOpError) {
    return jsonError("Failed to create operation record", 500);
  }

  const ai = initializeAI({
    openrouterApiKey: OPENROUTER_API_KEY,
    supabase,
    userId: user.id,
    campaignId: campaign_id,
  });

  const generationService = ai.createGenerationService({ campaignId: campaign_id });

  // Tracked async generator: transitions background_operations in_progress -> completed/failed
  async function* trackedEvents(): AsyncGenerator<GenerationProgressEvent> {
    await supabase
      .from("background_operations")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", bgOp.id);

    let succeeded = false;
    try {
      for await (const event of generationService.run({ batchSize: batch_size, bgOpId: bgOp.id })) {
        yield event;
        if (event.type === "done") succeeded = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      yield { type: "error", error: message };
    } finally {
      await supabase
        .from("background_operations")
        .update({
          status: succeeded ? "completed" : "failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", bgOp.id);
    }
  }

  return createSSEResponse(trackedEvents());
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
