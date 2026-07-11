import type { ResolvedProfile } from "@/lib/ai/generation/profile";
import type { TaggedFragment } from "@/lib/ai/generation/retrieval";

/** Serialized original idea fed to the regeneration prompt. */
export interface OriginalIdeaForPrompt {
  working_title: string;
  hook: string | null;
  key_points: string[] | null;
  key_quotes: string[];
  proposed_flow: string | null;
  insights_conclusions: string | null;
  call_to_action: string | null;
  storytelling_angle: string | null;
  target_audience_note: string | null;
  content_format_suggestion: string | null;
}

export interface RegenerationUserPromptParams {
  originalIdeas: OriginalIdeaForPrompt[];
  campaignTitle: string;
  campaignGoal: string | null;
  campaignDescription: string | null;
  batchSize: number;
  fragments: TaggedFragment[];
  hint?: string;
}

/**
 * System prompt for the regeneration pipeline.
 *
 * Instructs the model to produce improved variations of existing ideas rather
 * than discovering new ones from scratch. The original ideas are provided in
 * the user message as structured data. An optional improvement hint directs
 * the regeneration; without one, the model should produce genuinely different
 * takes on the same themes.
 */
export function buildRegenerationSystemPrompt(profile: ResolvedProfile): string {
  const keywordsLine = profile.keywords.length > 0 ? `- Keywords to emphasise: ${profile.keywords.join(", ")}` : "";

  return `You are a content strategist and post idea generator specialising in B2B thought leadership content.

## Business Profile

- Tone of voice: ${profile.toneOfVoice}
- Target audience: ${profile.audience}
- Brand goal: ${profile.brandGoal}
- Content archetype: ${profile.archetype}${keywordsLine ? `\n${keywordsLine}` : ""}

## Your Task

Regenerate and improve existing post ideas. You will receive one or more original ideas as structured data, along with an optional improvement hint from the user. Your job is to produce the same number of new ideas that are genuinely better — not minor edits or paraphrases.

When an improvement hint is provided, treat it as directed feedback. Address what the user asked for specifically.
When no hint is provided, produce fresh alternative takes on the same themes — different angles, different hooks, different structures.

The source fragments provided in the user message are freshly retrieved and may differ from the fragments that informed the original ideas. Ground your regenerated ideas in these fragments and cite them by tag.

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

- Every idea MUST cite at least one fragment tag in source_references.
- key_quotes must be actual quotes copied verbatim from the fragment text — no paraphrasing.
- Each regenerated idea must be a genuine improvement, not a restatement of the original.
- When regenerating multiple ideas, each must be distinct: different angle, different source fragments, different call to action.
- When an improvement hint is provided, every regenerated idea must address it.
- Output raw JSON only — no markdown code fences, no commentary before or after the JSON.`;
}

/**
 * User prompt for a regeneration request.
 * Renders original ideas as structured data, an optional improvement hint,
 * campaign context, and freshly retrieved source fragments.
 */
export function buildRegenerationUserPrompt(params: RegenerationUserPromptParams): string {
  const { originalIdeas, campaignTitle, campaignGoal, campaignDescription, batchSize, fragments, hint } = params;

  const lines: string[] = [
    `Regenerate ${batchSize} idea${batchSize === 1 ? "" : "s"} based on the original${batchSize === 1 ? "" : "s"} below:`,
    "",
    "## Original Ideas",
    "",
  ];

  originalIdeas.forEach((idea, i) => {
    lines.push(`### Idea ${i + 1}`);
    lines.push(`- Working title: ${idea.working_title}`);
    if (idea.hook) lines.push(`- Hook: ${idea.hook}`);
    if (idea.key_points && idea.key_points.length > 0) {
      lines.push(`- Key points: ${idea.key_points.join("; ")}`);
    }
    if (idea.key_quotes.length > 0) {
      lines.push(`- Key quotes: ${idea.key_quotes.map((q) => `"${q}"`).join("; ")}`);
    }
    if (idea.proposed_flow) lines.push(`- Proposed flow: ${idea.proposed_flow}`);
    if (idea.insights_conclusions) lines.push(`- Insights: ${idea.insights_conclusions}`);
    if (idea.call_to_action) lines.push(`- Call to action: ${idea.call_to_action}`);
    if (idea.storytelling_angle) lines.push(`- Storytelling angle: ${idea.storytelling_angle}`);
    if (idea.target_audience_note) lines.push(`- Target audience: ${idea.target_audience_note}`);
    if (idea.content_format_suggestion) lines.push(`- Content format: ${idea.content_format_suggestion}`);
    lines.push("");
  });

  if (hint && hint.trim().length > 0) {
    lines.push("## Improvement Direction", "", hint.trim(), "");
  }

  lines.push("## Campaign Context", "", `Campaign title: ${campaignTitle}`);

  if (campaignGoal) {
    lines.push(`Campaign goal: ${campaignGoal}`);
  }

  if (campaignDescription) {
    lines.push(`Campaign description: ${campaignDescription}`);
  }

  lines.push("", "## Source Fragments", "");

  if (fragments.length === 0) {
    lines.push("(No fragments found — regenerate based on the original ideas and campaign context alone.)");
  } else {
    for (const f of fragments) {
      lines.push(`[${f.tag}] (${f.documentTitle}): ${f.chunkText}`);
    }
  }

  lines.push(
    "",
    `Return exactly ${batchSize} regenerated idea${batchSize === 1 ? "" : "s"} as a JSON object matching the schema in your system instructions.`,
    "Cite fragment tags (F1, F2, …) in source_references — do not invent tags not listed above.",
  );

  return lines.join("\n");
}
