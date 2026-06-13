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
import { createGenerationService as createGenService } from "./generation/service";

export interface AIContext {
  provider: Provider;
  embeddingService: EmbeddingService;
  searchService: SearchService;
  toolRegistry: ToolRegistry;
  createRunner(config: AgentRunnerConfig): ReturnType<typeof createAgentRunner>;
  createGenerationService(config: { campaignId: string }): ReturnType<typeof createGenService>;
}

/**
 * Wire all AI subsystems together.
 * Call once per request. Registers the OpenRouter provider in the global registry.
 */
export function initializeAI(config: {
  openrouterApiKey: string;
  supabase: SupabaseClient<Database>;
  /** Required when the tool registry is used (generate endpoint). */
  userId?: string;
  /** Required when the tool registry is used (generate endpoint). */
  campaignId?: string;
}): AIContext {
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
      const { query, limit } = args as unknown as {
        query?: string;
        limit?: number;
      };
      if (!query) return { ok: false, error: "query is required" };
      if (!config.campaignId) return { ok: false, error: "Campaign context not available" };
      try {
        const results = await searchService.search(query, config.campaignId, { limit });
        return { ok: true, output: JSON.stringify(results) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Search failed" };
      }
    },
  };

  toolRegistry.register(realSearchDocumentsTool);
  toolRegistry.register(createGetBusinessProfileTool(config.supabase, config.userId ?? ""));

  return {
    provider,
    embeddingService,
    searchService,
    toolRegistry,
    createRunner(runnerConfig: AgentRunnerConfig) {
      return createAgentRunner(runnerConfig, { provider, toolRegistry });
    },
    createGenerationService(genConfig: { campaignId: string }) {
      return createGenService({
        provider,
        searchService,
        supabase: config.supabase,
        userId: config.userId ?? "",
        campaignId: genConfig.campaignId,
      });
    },
  };
}
