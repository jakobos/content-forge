import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { initializeAI } from "@/lib/ai";
import { chunkText } from "@/lib/ai/embeddings";

const BodySchema = z.object({
  document_version_id: z.uuid(),
  content: z.string().min(1),
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
  const { document_version_id, content } = parsed.data;

  // Create background operation
  const { data: bgOp, error: bgOpError } = await supabase
    .from("background_operations")
    .insert({ user_id: user.id, type: "document_ingestion", status: "pending" })
    .select("id")
    .single();

  if (bgOpError) {
    return jsonError("Failed to create operation record", 500);
  }

  try {
    const ai = initializeAI({ openrouterApiKey: OPENROUTER_API_KEY, supabase });

    await supabase
      .from("background_operations")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", bgOp.id);

    await ai.embeddingService.embedDocument(document_version_id, content);

    const chunksCount = chunkText(content).length;

    await supabase
      .from("background_operations")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", bgOp.id);

    return new Response(JSON.stringify({ ok: true, chunks_count: chunksCount }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Embedding failed";

    await supabase
      .from("background_operations")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", bgOp.id);

    return jsonError(message, 500);
  }
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
