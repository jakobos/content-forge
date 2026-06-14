import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface ResolvedProfile {
  toneOfVoice: string;
  audience: string;
  brandGoal: string;
  archetype: string;
  keywords: string[];
}

/** Hardcoded defaults used when no business profile row exists. Ready for S-04 to swap. */
const DEFAULT_PROFILE: ResolvedProfile = {
  toneOfVoice: "professional, authoritative, evidence-driven",
  audience: "broad B2B professionals and decision-makers",
  brandGoal: "thought leadership — establish expertise, share insights, drive conversations",
  archetype: "expertise-driven — anchor every idea in a concrete finding, quote, or observation from source materials",
  keywords: [],
};

/**
 * Resolve the business profile for a user.
 * Returns the stored profile if present, otherwise falls back to hardcoded defaults.
 * On query error, falls back to defaults and does not throw.
 */
export async function resolveBusinessProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ResolvedProfile> {
  const { data, error } = await supabase
    .from("business_profiles")
    .select("tone_of_voice, audience, brand_goal, archetype, keywords")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { ...DEFAULT_PROFILE };
  }

  return {
    toneOfVoice: data.tone_of_voice ?? DEFAULT_PROFILE.toneOfVoice,
    audience: data.audience ?? DEFAULT_PROFILE.audience,
    brandGoal: data.brand_goal ?? DEFAULT_PROFILE.brandGoal,
    archetype: data.archetype ?? DEFAULT_PROFILE.archetype,
    keywords: data.keywords ?? [],
  };
}
