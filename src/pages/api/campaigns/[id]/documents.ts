import type { APIRoute } from "astro";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { createEmbeddingClient, createEmbeddingService } from "@/lib/ai/embeddings";

const MAX_CONTENT = 20_000;
const VALID_TYPES = ["source_document", "user_insight"] as const;
type DocumentType = (typeof VALID_TYPES)[number];

export const POST: APIRoute = async (context) => {
  const campaignId = context.params.id;
  if (!campaignId) {
    return context.redirect("/campaigns");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/campaigns/${campaignId}?error=${encodeURIComponent("Service is not configured")}`);
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const type = (form.get("type") as string | null) ?? "";
  const title = ((form.get("title") as string | null) ?? "").trim();
  const content = ((form.get("content") as string | null) ?? "").trim();
  const sourceUrlRaw = ((form.get("source_url") as string | null) ?? "").trim();
  const sourceUrl = sourceUrlRaw !== "" ? sourceUrlRaw : null;

  const errorBase = `/campaigns/${campaignId}?error=`;

  if (!VALID_TYPES.includes(type as DocumentType)) {
    return context.redirect(`${errorBase}${encodeURIComponent("Invalid document type")}`);
  }
  if (!title) {
    return context.redirect(`${errorBase}${encodeURIComponent("Title is required")}`);
  }
  if (!content) {
    return context.redirect(`${errorBase}${encodeURIComponent("Content is required")}`);
  }
  if (content.length > MAX_CONTENT) {
    return context.redirect(
      `${errorBase}${encodeURIComponent(`Content must be ${MAX_CONTENT.toLocaleString()} characters or fewer`)}`,
    );
  }

  // Verify campaign ownership
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single();

  if (!campaign) {
    return context.redirect("/campaigns");
  }

  // Insert document
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      campaign_id: campaignId,
      user_id: user.id,
      type: type as DocumentType,
      title,
      content,
      source_url: sourceUrl,
      current_version: 1,
    })
    .select("id")
    .single();

  if (docError) {
    return context.redirect(`${errorBase}${encodeURIComponent(docError.message)}`);
  }

  // Insert initial document version — select id so we can embed it
  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .insert({
      document_id: doc.id,
      version_number: 1,
      content,
    })
    .select("id")
    .single();

  if (versionError) {
    return context.redirect(`${errorBase}${encodeURIComponent(versionError.message)}`);
  }

  // Auto-embed the new document version synchronously before redirecting.
  // On Cloudflare Workers, code cannot run after the Response is returned, so
  // we must await this before calling context.redirect(). Failures are swallowed
  // so that document creation always succeeds.
  if (OPENROUTER_API_KEY) {
    // Track the embedding job in background_operations
    const { data: bgOp } = await supabase
      .from("background_operations")
      .insert({
        user_id: user.id,
        type: "document_ingestion",
        status: "in_progress",
        started_at: new Date().toISOString(),
        input_ref: { document_version_id: version.id },
      })
      .select("id")
      .single();

    try {
      const embeddingClient = createEmbeddingClient(OPENROUTER_API_KEY);
      const embeddingService = createEmbeddingService(supabase, embeddingClient);
      await embeddingService.embedDocument(version.id, content);

      // Mark completed
      if (bgOp) {
        await supabase
          .from("background_operations")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", bgOp.id);
      }
    } catch (e) {
      // Embedding failure must not block document creation
      if (bgOp) {
        await supabase
          .from("background_operations")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: e instanceof Error ? e.message : String(e),
          })
          .eq("id", bgOp.id);
      }
    }
  }

  return context.redirect(`/campaigns/${campaignId}?success=document_added`);
};
