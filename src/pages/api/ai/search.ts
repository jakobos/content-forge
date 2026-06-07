import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { initializeAI } from "@/lib/ai";

const BodySchema = z.object({
  campaign_id: z.uuid(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  strategy: z.enum(["hybrid", "vector", "fts"]).optional(),
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
  const { campaign_id, query, limit, strategy } = parsed.data;

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
    return jsonError("Campaign not found or access denied", 404);
  }

  try {
    const ai = initializeAI({ openrouterApiKey: OPENROUTER_API_KEY, supabase });
    const results = await ai.searchService.search(query, campaign_id, { limit, strategy });

    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Search failed", 500);
  }
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
