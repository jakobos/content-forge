import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { initializeAI } from "@/lib/ai";
import { createSSEResponse, createSSEErrorResponse } from "@/lib/ai/streaming";
import type { ProviderInputItem } from "@/lib/ai/providers";
import type { RunnerStreamEvent } from "@/lib/ai/runner";

const DEFAULT_MODEL = "openrouter:anthropic/claude-sonnet-4-20250514";

const BodySchema = z.object({
  campaign_id: z.uuid(),
  model: z.string().optional(),
  system_prompt: z.string().min(1),
  user_prompt: z.string().min(1),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return createSSEErrorResponse("Unauthorized");
  }

  if (!OPENROUTER_API_KEY) {
    return createSSEErrorResponse("AI not configured");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return createSSEErrorResponse("Database not configured");
  }

  // Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = (await context.request.json()) as unknown;
  } catch {
    return createSSEErrorResponse("Invalid JSON body");
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return createSSEErrorResponse(`Invalid request: ${parsed.error.issues[0]?.message ?? "bad input"}`);
  }
  const { campaign_id, model, system_prompt, user_prompt } = parsed.data;

  // Create background operation
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
    return createSSEErrorResponse("Failed to create operation record");
  }

  const ai = initializeAI({ openrouterApiKey: OPENROUTER_API_KEY, supabase });
  const runner = ai.createRunner({
    model: model ?? DEFAULT_MODEL,
    systemInstructions: system_prompt,
  });

  const input: ProviderInputItem[] = [{ type: "message", role: "user", content: user_prompt }];

  // Async generator that tracks status in background_operations
  async function* trackedEvents(): AsyncGenerator<RunnerStreamEvent> {
    await supabase
      .from("background_operations")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", bgOp.id);

    let succeeded = false;
    try {
      for await (const event of runner.run(input)) {
        yield event;
        if (event.type === "runner_done") succeeded = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      yield { type: "runner_error", error: message };
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
