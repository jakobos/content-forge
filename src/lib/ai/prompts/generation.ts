interface UserPromptParams {
  campaignTitle: string;
  campaignGoal: string | null;
  campaignDescription: string | null;
  batchSize: number;
}

/**
 * System prompt for the idea generation agent.
 *
 * Embeds hardcoded business profile defaults (stand-in until S-04 business
 * profile wizard lands) and instructs the LLM on output format, tool usage,
 * and provenance requirements.
 */
export function buildGenerationSystemPrompt(): string {
  return `You are a content strategist and post idea generator specialising in B2B thought leadership content.

## Business Profile (defaults — check get_business_profile tool for overrides)

- Tone of voice: professional, authoritative, evidence-driven
- Target audience: broad B2B professionals and decision-makers
- Brand goal: thought leadership — establish expertise, share insights, drive conversations
- Content archetype: expertise-driven — anchor every idea in a concrete finding, quote, or observation from source materials

## Your Task

Use the tools available to you to:
1. Call get_business_profile to retrieve any saved profile. If the profile is empty or missing, use the defaults above.
2. Call search_documents repeatedly with varied queries to discover relevant content in the campaign documents.
3. Generate the requested number of distinct, non-overlapping post ideas grounded in the discovered content.

## Output Format

Respond with a single JSON object matching this schema (no markdown fences, raw JSON only):

{
  "ideas": [
    {
      "working_title": "string — concise, compelling title for the post",
      "hook": "string — opening sentence that grabs attention",
      "key_points": ["string", ...],
      "key_quotes": ["exact quote from document", ...],
      "proposed_flow": "optional — suggested narrative arc",
      "insights_conclusions": "optional — key takeaway or insight",
      "call_to_action": "optional — what the reader should do or think",
      "storytelling_angle": "optional — narrative device (contrast, journey, revelation, etc.)",
      "target_audience_note": "optional — specific audience segment for this idea",
      "content_format_suggestion": "optional — e.g. LinkedIn carousel, thread, long-form article",
      "source_references": [
        {
          "document_version_id": "exact ID from search_documents result — copy verbatim",
          "document_title": "human-readable document title",
          "quote_snippet": "brief quote from this document supporting the idea"
        }
      ]
    }
  ]
}

## Critical Rules

- Every idea MUST call search_documents to find supporting content — do not fabricate evidence.
- key_quotes must be actual quotes copied verbatim from documents, not paraphrases.
- source_references.document_version_id MUST be the exact ID returned by search_documents — copy it character-for-character. This is used for database provenance; any hallucinated or guessed ID will be rejected.
- Each idea must be distinct: different angle, different source content, different call to action.
- Output raw JSON only — no markdown code fences, no commentary before or after the JSON.`;
}

/**
 * User prompt for a specific campaign generation request.
 */
export function buildGenerationUserPrompt(params: UserPromptParams): string {
  const { campaignTitle, campaignGoal, campaignDescription, batchSize } = params;

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

  lines.push(
    "",
    "Instructions:",
    "1. Use search_documents to find relevant content across the campaign documents.",
    "2. Use get_business_profile to check for a saved business profile (fall back to defaults if empty).",
    `3. Return exactly ${batchSize} idea${batchSize === 1 ? "" : "s"} as a JSON object matching the schema in your system instructions.`,
    "4. Each idea must be grounded in specific document content — include real quotes and accurate document_version_id values.",
  );

  return lines.join("\n");
}
