import type { Enums } from "@/db/database.types";

export type CampaignStatus = Enums<"campaign_status">;

/** Label map for campaign status badges */
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

/**
 * Tailwind utility class strings for campaign status badges.
 * Mirrors the IDEA_STATUS_CLASS pattern in src/lib/ideas/lifecycle.ts.
 */
export const CAMPAIGN_STATUS_CLASS: Record<CampaignStatus, string> = {
  draft: "bg-muted/50 text-muted-foreground border-muted-foreground/40",
  active: "bg-accent/20 text-accent border-accent/40",
  completed: "bg-primary/20 text-primary border-primary/40",
  archived: "bg-muted/30 text-muted-foreground/60 border-muted-foreground/30",
};
