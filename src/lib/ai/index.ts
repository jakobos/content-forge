import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { initializeProviders, getProvider } from "./providers";
import type { Provider } from "./providers";
import { createEmbeddingClient, createEmbeddingService } from "./embeddings";
import type { EmbeddingService } from "./embeddings";
import { createSearchService } from "./search";
import type { SearchService } from "./search";
import {
  createGenerationService as createGenService,
  createStructuringService as createStructService,
  createRegenerationService as createRegenService,
} from "./generation/service";

export interface AIContext {
  provider: Provider;
  embeddingService: EmbeddingService;
  searchService: SearchService;
  createGenerationService(config: { campaignId: string }): ReturnType<typeof createGenService>;
  createStructuringService(config: { campaignId: string }): ReturnType<typeof createStructService>;
  createRegenerationService(config: { campaignId: string }): ReturnType<typeof createRegenService>;
}

/**
 * Wire all AI subsystems together.
 * Call once per request. Registers the OpenRouter provider in the global registry.
 */
export function initializeAI(config: {
  openrouterApiKey: string;
  supabase: SupabaseClient<Database>;
  userId: string;
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

  return {
    provider,
    embeddingService,
    searchService,
    createGenerationService(genConfig: { campaignId: string }) {
      return createGenService({
        provider,
        searchService,
        supabase: config.supabase,
        userId: config.userId,
        campaignId: genConfig.campaignId,
      });
    },
    createStructuringService(structConfig: { campaignId: string }) {
      return createStructService({
        provider,
        searchService,
        supabase: config.supabase,
        userId: config.userId,
        campaignId: structConfig.campaignId,
      });
    },
    createRegenerationService(regenConfig: { campaignId: string }) {
      return createRegenService({
        provider,
        searchService,
        supabase: config.supabase,
        userId: config.userId,
        campaignId: regenConfig.campaignId,
      });
    },
  };
}
