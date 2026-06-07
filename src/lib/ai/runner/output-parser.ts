import { z } from "zod";

/**
 * Parse and validate a string as structured JSON using a Zod schema.
 *
 * Handles common LLM output issues:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 */
export function parseStructuredOutput<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: string } {
  // Strip markdown code fences
  let cleaned = text.trim();
  // Remove ```json or ``` prefix
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "");
  // Remove trailing ```
  cleaned = cleaned.replace(/\n?```\s*$/, "").trim();

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    const preview = cleaned.length > 120 ? `${cleaned.slice(0, 120)}…` : cleaned;
    return { ok: false, error: `JSON parse failed: ${preview}` };
  }

  // Validate with Zod schema
  const result = schema.safeParse(parsed);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const firstIssue = result.error.issues.at(0);
  const message = firstIssue
    ? `Validation failed at "${firstIssue.path.join(".")}" — ${firstIssue.message}`
    : result.error.message;

  return { ok: false, error: message };
}
