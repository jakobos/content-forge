import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { Constants } from "@/db/database.types";
import { canTransition } from "@/lib/ideas/lifecycle";
import type { IdeaStatus } from "@/lib/ideas/lifecycle";

const BodySchema = z.object({
  status: z.enum(Constants.public.Enums.idea_status as [IdeaStatus, ...IdeaStatus[]]),
});

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("Database not configured", 503);
  }

  const ideaId = context.params.id;
  if (!ideaId) {
    return jsonError("Missing idea id", 400);
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
  const target = parsed.data.status;

  // Fetch current idea status, scoped to the authenticated user
  const { data: idea, error: fetchError } = await supabase
    .from("ideas")
    .select("status")
    .eq("id", ideaId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    return jsonError("Database error fetching idea", 500);
  }
  if (!idea) {
    return jsonError("Idea not found", 404);
  }

  const current: IdeaStatus = idea.status;

  if (!canTransition(current, target)) {
    return jsonError(`Cannot transition from "${current}" to "${target}"`, 400);
  }

  // Persist — row-scoped to prevent unscoped bulk update (no RLS policies exist)
  const { error: updateError } = await supabase
    .from("ideas")
    .update({ status: target })
    .eq("id", ideaId)
    .eq("user_id", user.id);

  if (updateError) {
    return jsonError("Database error updating idea", 500);
  }

  return new Response(JSON.stringify({ ok: true, status: target }), {
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
