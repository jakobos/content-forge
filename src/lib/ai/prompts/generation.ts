import type { ResolvedProfile } from "@/lib/ai/generation/profile";
import type { TaggedFragment } from "@/lib/ai/generation/retrieval";

interface UserPromptParams {
  campaignTitle: string;
  campaignGoal: string | null;
  campaignDescription: string | null;
  batchSize: number;
  fragments: TaggedFragment[];
}

/**
 * System prompt for the deterministic idea generation pipeline.
 *
 * Embeds the resolved business profile and instructs the model to:
 * - produce raw JSON matching the schema (no markdown fences)
 * - ground every idea in the provided tagged fragments
 * - cite fragment tags (F1, F2, …) in source_references, not IDs
 * - copy key_quotes verbatim from fragment text
 *
 * No tool-usage instructions — retrieval is handled server-side.
 */
export function buildGenerationSystemPrompt(profile: ResolvedProfile): string {
  const keywordsLine = profile.keywords.length > 0 ? `- Keywords to emphasise: ${profile.keywords.join(", ")}` : "";

  return `You are a content strategist and post idea generator specialising in B2B thought leadership content.

## Business Profile

- Tone of voice: ${profile.toneOfVoice}
- Target audience: ${profile.audience}
- Brand goal: ${profile.brandGoal}
- Content archetype: ${profile.archetype}${keywordsLine ? `\n${keywordsLine}` : ""}

## Your Task

Generate the requested number of distinct, non-overlapping post ideas grounded in the source fragments provided in the user message. The fragments are tagged [F1], [F2], etc. You must cite them by tag in each idea's source_references.

## Output Format

Respond with a single JSON object matching this schema (no markdown fences, raw JSON only):

{
  "ideas": [
    {
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
  ]
}

## Critical Rules

- If source fragments are provided, every idea MUST cite at least one fragment tag in source_references and include verbatim key_quotes from those fragments — no paraphrasing.
- If NO source fragments are provided, return empty arrays for source_references and key_quotes.
- Each idea must be distinct: different angle, different call to action.
- Output raw JSON only — no markdown code fences, no commentary before or after the JSON.`;
}

/**
 * User prompt for a specific campaign generation request.
 * Renders the tagged fragment block inline so the model has all context it needs.
 */
export function buildGenerationUserPrompt(params: UserPromptParams): string {
  const { campaignTitle, campaignGoal, campaignDescription, batchSize, fragments } = params;

  const lines: string[] = [
    `Generate ${batchSize} structured post idea${batchSize === 1 ? "" : "s"} for the following campaign:`,
    "",
    `Campaign title: ${campaignTitle}`,
  ];

  if (campaignGoal) {
    lines.push(`Campaign goal: ${campaignGoal}`);
  }

  if (campaignDescription) {
    lines.push(`Campaign description: ${campaignDescription}`);
  }

  lines.push("", "## Source Fragments", "");

  if (fragments.length === 0) {
    lines.push("(No fragments found — generate ideas based on campaign context alone.)");
  } else {
    for (const f of fragments) {
      lines.push(`[${f.tag}] (${f.documentTitle}): ${f.chunkText}`);
    }
  }

  lines.push(
    "",
    `Return exactly ${batchSize} idea${batchSize === 1 ? "" : "s"} as a JSON object matching the schema in your system instructions.`,
    "Cite fragment tags (F1, F2, …) in source_references — do not invent tags not listed above.",
  );

  return lines.join("\n");
}
