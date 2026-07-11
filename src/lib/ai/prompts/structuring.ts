import type { ResolvedProfile } from "@/lib/ai/generation/profile";
import type { TaggedFragment } from "@/lib/ai/generation/retrieval";

export interface StructuringUserPromptParams {
  description: string;
  campaignTitle: string;
  campaignGoal: string | null;
  campaignDescription: string | null;
  fragments: TaggedFragment[];
}

/**
 * System prompt for the manual idea structuring path.
 *
 * Instructs the model to structure a user-provided concept into a formatted
 * post idea rather than discovering ideas from documents.
 */
export function buildStructuringSystemPrompt(profile: ResolvedProfile): string {
  const keywordsLine = profile.keywords.length > 0 ? `- Keywords to emphasise: ${profile.keywords.join(", ")}` : "";

  return `You are a content strategist specialising in B2B thought leadership content.

## Business Profile

- Tone of voice: ${profile.toneOfVoice}
- Target audience: ${profile.audience}
- Brand goal: ${profile.brandGoal}
- Content archetype: ${profile.archetype}${keywordsLine ? `\n${keywordsLine}` : ""}

## Your Task

Structure the user-provided idea description into a formatted post idea. The user's description is the primary input — your job is to enrich and organise it using the campaign context and any relevant source fragments provided.

## Output Format

Respond with a single JSON object matching this schema (no markdown fences, raw JSON only):

{
  "idea": {
    "working_title": "string — concise, compelling title for the post",
    "hook": "string — opening sentence that grabs attention",
    "key_points": ["string", ...],
    "key_quotes": ["exact verbatim quote copied from a fragment", ...],
    "proposed_flow": "optional — suggested narrative arc",
    "insights_conclusions": "optional — key takeaway or insight",
    "call_to_action": "optional — what the reader should do or think",
    "storytelling_angle": "optional — narrative device (contrast, journey, revelation, etc.)",
    "target_audience_note": "optional — specific audience segment for this idea",
    "content_format_suggestion": "optional — e.g. LinkedIn carousel, thread, long-form article",
    "source_references": [
      {
        "tag": "F1",
        "quote_snippet": "brief quote from this fragment supporting the idea"
      }
    ]
  }
}

## Rules

- The user's description drives the idea — preserve the user's intent and angle.
- If source fragments are provided, cite relevant ones in source_references using their tags (F1, F2, …).
- key_quotes must be verbatim quotes copied from fragment text — no paraphrasing.
- If no fragments are relevant to the user's description, source_references and key_quotes may be empty arrays.
- Do not invent fragment tags not listed in the user message.
- Output raw JSON only — no markdown code fences, no commentary before or after the JSON.`;
}

/**
 * User prompt for a manual idea structuring request.
 * The user's description is rendered prominently; fragments are optional enrichment.
 */
export function buildStructuringUserPrompt(params: StructuringUserPromptParams): string {
  const { description, campaignTitle, campaignGoal, campaignDescription, fragments } = params;

  const lines: string[] = [
    "Structure the following idea description into a formatted post idea:",
    "",
    "## User's Idea Description",
    "",
    description,
    "",
    "## Campaign Context",
    "",
    `Campaign title: ${campaignTitle}`,
  ];

  if (campaignGoal) {
    lines.push(`Campaign goal: ${campaignGoal}`);
  }

  if (campaignDescription) {
    lines.push(`Campaign description: ${campaignDescription}`);
  }

  lines.push("", "## Source Fragments (optional enrichment)", "");

  if (fragments.length === 0) {
    lines.push("(No fragments found — structure the idea based on the user's description and campaign context alone.)");
  } else {
    for (const f of fragments) {
      lines.push(`[${f.tag}] (${f.documentTitle}): ${f.chunkText}`);
    }
  }

  lines.push(
    "",
    "Return a single structured idea as a JSON object matching the schema in your system instructions.",
    "If source fragments are relevant to the user's description, cite them. If none are relevant, return empty arrays for source_references and key_quotes.",
    "Do not invent fragment tags not listed above.",
  );

  return lines.join("\n");
}
