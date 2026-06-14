import { z } from "zod";

export const SourceReferenceSchema = z.object({
  /** Fragment tag (F1, F2, …) assigned by the server-side retrieval step. */
  tag: z.string(),
  /** Direct quote snippet from the source fragment. */
  quote_snippet: z.string(),
});

export const IdeaSchema = z.object({
  working_title: z.string(),
  // .nullable() handles OpenAI-family models that return null for absent optional fields
  // under strict structured output (strict: true). Claude omits absent fields; other
  // models on OpenRouter return null. Both are accepted.
  hook: z.string().optional().nullable(),
  key_points: z.array(z.string()).optional().nullable(),
  /** Direct quotes from source documents — at least one required per idea. */
  key_quotes: z.array(z.string()).min(1),
  proposed_flow: z.string().optional().nullable(),
  insights_conclusions: z.string().optional().nullable(),
  call_to_action: z.string().optional().nullable(),
  storytelling_angle: z.string().optional().nullable(),
  target_audience_note: z.string().optional().nullable(),
  content_format_suggestion: z.string().optional().nullable(),
  /** Source fragment references — at least one required per idea. */
  source_references: z.array(SourceReferenceSchema).min(1),
});

export const IdeaOutputSchema = z.object({
  ideas: z.array(IdeaSchema),
});

export type IdeaOutput = z.infer<typeof IdeaOutputSchema>;

/**
 * Plain JSON Schema object equivalent to IdeaOutputSchema.
 * Used as the `responseFormat.jsonSchema.schema` for native structured output (Phase 1).
 * Keep in sync with IdeaSchema / SourceReferenceSchema above.
 */
export const IdeaOutputJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          working_title: { type: "string" },
          // ["string", "null"] mirrors the .nullable() on IdeaSchema optional fields.
          // OpenAI-family models return null for absent optional fields under strict output.
          hook: { type: ["string", "null"] },
          key_points: { type: ["array", "null"], items: { type: "string" } },
          key_quotes: { type: "array", items: { type: "string" }, minItems: 1 },
          proposed_flow: { type: ["string", "null"] },
          insights_conclusions: { type: ["string", "null"] },
          call_to_action: { type: ["string", "null"] },
          storytelling_angle: { type: ["string", "null"] },
          target_audience_note: { type: ["string", "null"] },
          content_format_suggestion: { type: ["string", "null"] },
          source_references: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tag: { type: "string" },
                quote_snippet: { type: "string" },
              },
              required: ["tag", "quote_snippet"],
              additionalProperties: false,
            },
            minItems: 1,
          },
        },
        required: ["working_title", "key_quotes", "source_references"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};
