import { z } from "zod";

export const SourceReferenceSchema = z.object({
  /** Opaque ID echoed back from a search_documents result — copy verbatim for provenance. */
  document_version_id: z.string().optional(),
  /** Human-readable document title used as fallback when ID is absent. */
  document_title: z.string(),
  /** Direct quote snippet from the source document. */
  quote_snippet: z.string(),
});

export const IdeaSchema = z.object({
  working_title: z.string(),
  hook: z.string().optional(),
  key_points: z.array(z.string()).optional(),
  /** Direct quotes from source documents — at least one required per idea. */
  key_quotes: z.array(z.string()).min(1),
  proposed_flow: z.string().optional(),
  insights_conclusions: z.string().optional(),
  call_to_action: z.string().optional(),
  storytelling_angle: z.string().optional(),
  target_audience_note: z.string().optional(),
  content_format_suggestion: z.string().optional(),
  /** Source document references — at least one required per idea. */
  source_references: z.array(SourceReferenceSchema).min(1),
});

export const IdeaOutputSchema = z.object({
  ideas: z.array(IdeaSchema),
});

export type IdeaOutput = z.infer<typeof IdeaOutputSchema>;
