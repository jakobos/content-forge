import type { Tool } from "../types";

/**
 * Stub implementation — wired to the real hybrid search service in Phase 5.
 * The LLM can call this tool to retrieve relevant document chunks from a campaign.
 */
export const searchDocumentsTool: Tool = {
  type: "async",

  definition: {
    type: "function",
    name: "search_documents",
    description:
      "Search campaign documents using hybrid semantic + keyword search. Returns relevant text chunks with similarity scores. Use when you need context from the user's uploaded documents.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query",
        },
        campaign_id: {
          type: "string",
          description: "UUID of the campaign whose documents to search",
        },
        limit: {
          type: "number",
          description: "Maximum number of chunks to return (default 10, max 20)",
        },
      },
      required: ["query", "campaign_id"],
    },
  },

  handler: (_args, _signal) => {
    // Stub — real implementation wired in Phase 5 / Phase 7 initializeAI
    return Promise.resolve({ ok: false, error: "Search service not initialized" } as const);
  },
};
