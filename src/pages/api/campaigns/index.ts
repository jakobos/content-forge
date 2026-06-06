import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/campaigns/new?error=${encodeURIComponent("Service is not configured")}`);
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const title = ((form.get("title") as string | null) ?? "").trim();
  const goalRaw = ((form.get("goal") as string | null) ?? "").trim();
  const descriptionRaw = ((form.get("description") as string | null) ?? "").trim();
  const goal = goalRaw !== "" ? goalRaw : null;
  const description = descriptionRaw !== "" ? descriptionRaw : null;

  if (!title) {
    return context.redirect(`/campaigns/new?error=${encodeURIComponent("Title is required")}`);
  }

  const { data, error } = await supabase
    .from("campaigns")
    .insert({ user_id: user.id, title, goal, description, status: "draft" })
    .select("id")
    .single();

  if (error) {
    return context.redirect(`/campaigns/new?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect(`/campaigns/${data.id}`);
};
