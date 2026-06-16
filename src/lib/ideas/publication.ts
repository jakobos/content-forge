import { z } from "zod";
import type { Tables } from "@/db/database.types";

/**
 * Zod validation schema for publication input.
 * All fields are optional; blank strings are normalized to null so clearing
 * a field persists null to the DB rather than an empty string.
 */
export const PublicationInputSchema = z.object({
  url: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(
      z
        .url()
        .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
          message: "URL must use http or https protocol",
        })
        .optional(),
    ),
  platform_name: z
    .string()
    .max(200, "Platform name must be 200 characters or fewer")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  published_at: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
        .refine((v) => !isNaN(Date.parse(v)), { message: "Date must be a valid calendar date" })
        .optional(),
    ),
  note: z
    .string()
    .max(2000, "Note must be 2000 characters or fewer")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type PublicationInput = z.infer<typeof PublicationInputSchema>;

/** Full DB row type for a publication record. */
export type PublicationRow = Tables<"publications">;
