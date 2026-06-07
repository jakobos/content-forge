import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { initializeProviders, getProvider } from "./providers";
import type { Provider } from "./providers";
import { createEmbeddingClient, createEmbeddingService } from "./embeddings";
import type { EmbeddingService } from "./embeddings";
import { createSearchService } from "./search";
import type { SearchService } from "./search";
import { createToolRegistry } from "./tools";
import { searchDocumentsTool, createGetBusinessProfileTool } from "./tools/definitions";
import type { Tool, ToolRegistry } from "./tools";
import { createAgentRunner } from "./runner";
import type { AgentRunnerConfig } from "./runner";

export interface AIContext {
  provider: Provider;
  embeddingService: EmbeddingService;
  searchService: SearchService;
  toolRegistry: ToolRegistry;
  createRunner(config: AgentRunnerConfig): ReturnType<typeof createAgentRunner>;
}

/**
 * Wire all AI subsystems together.
 * Call once per request. Registers the OpenRouter provider in the global registry.
 */
export function initializeAI(config: { openrouterApiKey: string; supabase: SupabaseClient<Database> }): AIContext {
  // Register the OpenRouter provider
  initializeProviders({ openrouterApiKey: config.openrouterApiKey });

  const provider = getProvider("openrouter");
  if (!provider) throw new Error("OpenRouter provider failed to register");

  // Embedding layer
  const embeddingClient = createEmbeddingClient(config.openrouterApiKey);
  const embeddingService = createEmbeddingService(config.supabase, embeddingClient);

  // Search layer
  const searchService = createSearchService(config.supabase, embeddingClient);

  // Tool registry — wire search_documents to the real search service
  const toolRegistry = createToolRegistry();

  const realSearchDocumentsTool: Tool = {
    type: searchDocumentsTool.type,
    definition: searchDocumentsTool.definition,
    handler: async (args, _signal) => {
      const { query, campaign_id, limit } = args as unknown as {
        query?: string;
        campaign_id?: string;
        limit?: number;
      };
      if (!query) return { ok: false, error: "query is required" };
      if (!campaign_id) return { ok: false, error: "campaign_id is required" };
      try {
        const results = await searchService.search(query, campaign_id, { limit });
        return { ok: true, output: JSON.stringify(results) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Search failed" };
      }
    },
  };

  toolRegistry.register(realSearchDocumentsTool);
  toolRegistry.register(createGetBusinessProfileTool(config.supabase));

  return {
    provider,
    embeddingService,
    searchService,
    toolRegistry,
    createRunner(runnerConfig: AgentRunnerConfig) {
      return createAgentRunner(runnerConfig, { provider, toolRegistry });
    },
  };
}
