import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Tool } from "../types";

type BusinessProfileRow = Database["public"]["Tables"]["business_profiles"]["Row"];

/** Fields exposed to the LLM from a business profile. */
interface BusinessProfileResult {
  tone_of_voice: string | null;
  audience: string | null;
  keywords: string[] | null;
  archetype: string | null;
  brand_goal: string | null;
  pain_points: string | null;
  delivered_value: string | null;
  transformation: string | null;
  preferred_formats: string[] | null;
}

function toResult(row: BusinessProfileRow): BusinessProfileResult {
  return {
    tone_of_voice: row.tone_of_voice,
    audience: row.audience,
    keywords: row.keywords,
    archetype: row.archetype,
    brand_goal: row.brand_goal,
    pain_points: row.pain_points,
    delivered_value: row.delivered_value,
    transformation: row.transformation,
    preferred_formats: row.preferred_formats,
  };
}

/**
 * Factory: create the get_business_profile tool bound to a Supabase client.
 * Call once during AI initialization (Phase 7 initializeAI).
 */
export function createGetBusinessProfileTool(supabase: SupabaseClient<Database>): Tool {
  return {
    type: "sync",

    definition: {
      type: "function",
      name: "get_business_profile",
      description:
        "Retrieve the user's business profile for brand-aligned generation. Contains tone of voice, target audience, keywords, archetype, and other brand settings. Call at the start of generation to ensure output matches the brand.",
      parameters: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "UUID of the user whose business profile to retrieve",
          },
        },
        required: ["user_id"],
      },
    },

    handler: async (args, _signal) => {
      const { user_id } = args as { user_id?: string };

      if (!user_id || typeof user_id !== "string") {
        return { ok: false, error: "user_id is required and must be a string" };
      }

      try {
        const { data, error } = await supabase
          .from("business_profiles")
          .select(
            "tone_of_voice,audience,keywords,archetype,brand_goal,pain_points,delivered_value,transformation,preferred_formats",
          )
          .eq("user_id", user_id)
          .maybeSingle();

        if (error) {
          return { ok: false, error: `Database error: ${error.message}` };
        }

        if (!data) {
          return {
            ok: false,
            error: `No business profile found for user ${user_id}. Hint: the user may not have completed their profile setup.`,
          };
        }

        return { ok: true, output: JSON.stringify(toResult(data)) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to retrieve business profile",
        };
      }
    },
  };
}
