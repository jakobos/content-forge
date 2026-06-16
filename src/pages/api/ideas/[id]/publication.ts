import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { PublicationInputSchema } from "@/lib/ideas/publication";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const PUT: APIRoute = async (context) => {
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

  const parsed = PublicationInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(`Invalid request: ${parsed.error.issues[0]?.message ?? "bad input"}`, 400);
  }
  const { url, platform_name, published_at, note } = parsed.data;

  // Verify ownership + published state
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
  if (idea.status !== "published") {
    return jsonError("Idea is not published", 409);
  }

  // Upsert publication row (conflict on idea_id — unique constraint)
  const { error: upsertError } = await supabase.from("publications").upsert(
    {
      idea_id: ideaId,
      url: url ?? null,
      platform_name: platform_name ?? null,
      published_at: published_at ?? null,
      note: note ?? null,
    },
    { onConflict: "idea_id" },
  );

  if (upsertError) {
    return jsonError("Database error saving publication", 500);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const DELETE: APIRoute = async (context) => {
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

  // Verify ownership + published state
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
  if (idea.status !== "published") {
    return jsonError("Idea is not published", 409);
  }

  // Delete publication row
  const { error: deleteError } = await supabase.from("publications").delete().eq("idea_id", ideaId);

  if (deleteError) {
    return jsonError("Database error deleting publication", 500);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
