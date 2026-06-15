/**
 * Minimal input types for the markdown serializer.
 * Matches the fields selected in src/pages/campaigns/[id].astro and used in the SSR card.
 */
export interface IdeaForMarkdown {
  working_title: string;
  hook?: string | null;
  key_points?: string[] | null; // nullable
  key_quotes: string[]; // NOT NULL default '{}'
  proposed_flow?: string | null;
  insights_conclusions?: string | null;
  call_to_action?: string | null;
  storytelling_angle?: string | null;
  target_audience_note?: string | null;
  content_format_suggestion?: string | null;
}

export interface FragmentRef {
  documentTitle: string;
  quoteSnippet?: string | null;
}

/**
 * Convert an idea and its fragment references into a complete markdown document.
 * Mirrors the field labels used in the SSR card ([id].astro:188-292).
 * Only emits sections for non-empty fields.
 */
export function ideaToMarkdown(idea: IdeaForMarkdown, refs: FragmentRef[]): string {
  const lines: string[] = [];

  lines.push(`# ${idea.working_title}`);

  if (idea.hook) {
    lines.push("", "## Hook", "", idea.hook);
  }

  if (idea.key_points && idea.key_points.length > 0) {
    lines.push("", "## Key Points", "");
    for (const pt of idea.key_points) {
      lines.push(`- ${pt}`);
    }
  }

  if (idea.key_quotes.length > 0) {
    lines.push("", "## Key Quotes", "");
    for (const q of idea.key_quotes) {
      lines.push(`> ${q}`);
    }
  }

  if (idea.proposed_flow) {
    lines.push("", "## Proposed Flow", "", idea.proposed_flow);
  }

  if (idea.insights_conclusions) {
    lines.push("", "## Insights & Conclusions", "", idea.insights_conclusions);
  }

  if (idea.call_to_action) {
    lines.push("", "## Call to Action", "", idea.call_to_action);
  }

  if (idea.storytelling_angle) {
    lines.push("", "## Storytelling Angle", "", idea.storytelling_angle);
  }

  if (idea.target_audience_note) {
    lines.push("", "## Target Audience", "", idea.target_audience_note);
  }

  if (idea.content_format_suggestion) {
    lines.push("", "## Content Format", "", idea.content_format_suggestion);
  }

  if (refs.length > 0) {
    lines.push("", "## Sources", "");
    for (const ref of refs) {
      lines.push(`- **${ref.documentTitle}**`);
      if (ref.quoteSnippet) {
        lines.push(`  > "${ref.quoteSnippet}"`);
      }
    }
  }

  return lines.join("\n");
}
