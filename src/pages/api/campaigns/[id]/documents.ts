import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

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

  // Insert initial document version
  const { error: versionError } = await supabase.from("document_versions").insert({
    document_id: doc.id,
    version_number: 1,
    content,
  });

  if (versionError) {
    return context.redirect(`${errorBase}${encodeURIComponent(versionError.message)}`);
  }

  return context.redirect(`/campaigns/${campaignId}?success=document_added`);
};
