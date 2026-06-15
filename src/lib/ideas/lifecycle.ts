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
  draft: "bg-slate-500/30 text-slate-300 border-slate-500/40",
  accepted: "bg-green-500/20 text-green-300 border-green-500/40",
  published: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  archived: "bg-gray-500/20 text-gray-400 border-gray-500/40",
  declined: "bg-red-500/20 text-red-300 border-red-500/40",
};
