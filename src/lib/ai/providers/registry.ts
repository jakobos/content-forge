import type { Provider } from "./types";

const _registry = new Map<string, Provider>();

export function registerProvider(provider: Provider): void {
  _registry.set(provider.name, provider);
}

export function getProvider(name: string): Provider | undefined {
  return _registry.get(name);
}

export function listProviders(): string[] {
  return Array.from(_registry.keys());
}

/** Parse a "provider:model" model string into its components. */
export function parseModelString(modelString: string): { providerName: string; model: string } | undefined {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) return undefined;
  const providerName = modelString.slice(0, colonIndex);
  const model = modelString.slice(colonIndex + 1);
  if (!providerName || !model) return undefined;
  return { providerName, model };
}

/** Resolve a "provider:model" string to a registered provider and model name. */
export function resolveProvider(modelString: string): { provider: Provider; model: string } | undefined {
  const parsed = parseModelString(modelString);
  if (!parsed) return undefined;
  const provider = getProvider(parsed.providerName);
  if (!provider) return undefined;
  return { provider, model: parsed.model };
}
