// Types
export type {
  ContentPart,
  Content,
  ProviderInputItem,
  ProviderOutputItem,
  ProviderUsage,
  FinishReason,
  ProviderResponse,
  ProviderStreamEvent,
  ToolDefinition,
  ResponseFormat,
  ProviderRequest,
  Provider,
} from "./types";
export { isAbortError, throwIfAborted } from "./types";

// Registry — import first so we can also use them in initializeProviders
import { registerProvider, getProvider, listProviders, parseModelString, resolveProvider } from "./registry";
export { registerProvider, getProvider, listProviders, parseModelString, resolveProvider };

// OpenRouter — same pattern
import { createOpenRouterProvider } from "./openrouter";
import type { OpenRouterConfig } from "./openrouter";
export { createOpenRouterProvider };
export type { OpenRouterConfig };

/**
 * Initialize providers based on available API keys.
 * Idempotent — re-calling re-registers (replaces) the same providers.
 */
export function initializeProviders(config: { openrouterApiKey?: string }): void {
  if (config.openrouterApiKey) {
    registerProvider(createOpenRouterProvider({ apiKey: config.openrouterApiKey }));
  }
}
