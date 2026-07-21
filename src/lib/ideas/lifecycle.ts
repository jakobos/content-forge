import type { Enums } from "@/db/database.types";

export type IdeaStatus = Enums<"idea_status">;

/**
 * Allowed lifecycle transitions for idea statuses.
 * Both the status endpoint (validation) and the IdeaActions island (which buttons to show) consume this map.
 */
export const ALLOWED_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  draft: ["accepted", "declined"],
  accepted: ["published", "archived", "declined"],
  published: ["archived"],
  archived: ["accepted"],
  declined: ["draft"],
};

export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: IdeaStatus): IdeaStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/** Label map for idea status badges */
export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  draft: "Draft",
  accepted: "Accepted",
  published: "Published",
  archived: "Archived",
  declined: "Declined",
};

/**
 * Tailwind utility class strings for idea status badges.
 * Mirrors the campaign statusClass record-map pattern in [id].astro.
 */
export const IDEA_STATUS_CLASS: Record<IdeaStatus, string> = {
  draft: "bg-muted/50 text-muted-foreground border-muted-foreground/40",
  accepted: "bg-accent/20 text-accent border-accent/40",
  published: "bg-primary/20 text-primary border-primary/40",
  archived: "bg-muted/30 text-muted-foreground/60 border-muted-foreground/30",
  declined: "bg-destructive/20 text-destructive border-destructive/40",
};
