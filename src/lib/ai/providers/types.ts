// Content types for multimodal support
export type ContentPart =
  { type: "text"; text: string } | { type: "image"; uri: string } | { type: "image"; data: string; mimeType: string };

export type Content = string | ContentPart[];

// Conversation history items (input to provider)
export type ProviderInputItem =
  | { type: "message"; role: "user" | "assistant" | "system"; content: Content }
  | { type: "function_call"; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "function_result"; callId: string; name: string; output: string }
  | { type: "reasoning"; text: string; signature?: string; provider?: string };

// Response output items (output from provider)
export type ProviderOutputItem =
  | { type: "text"; text: string }
  | { type: "function_call"; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "reasoning"; text: string; signature?: string; provider?: string };

// Token usage metrics
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

// Why generation stopped
export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error";

// Complete non-streaming response
export interface ProviderResponse {
  id: string;
  model: string;
  output: ProviderOutputItem[];
  usage?: ProviderUsage;
  finishReason?: FinishReason;
}

// Streaming events (discriminated union)
export type ProviderStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "text_done"; text: string }
  | { type: "function_call_delta"; callId: string; name: string; argumentsDelta: string }
  | { type: "function_call_done"; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "reasoning_delta"; delta: string }
  | { type: "reasoning_done"; text: string }
  | { type: "done"; response: ProviderResponse }
  | { type: "error"; error: string; code?: string };

// Tool definition sent to the LLM
export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean | null;
}

/**
 * Structured-output format constraint for JSON-schema-constrained responses.
 * Maps to OpenRouter's `response_format: { type: "json_schema", json_schema: { ... } }`.
 */
export interface ResponseFormat {
  type: "json_schema";
  jsonSchema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

// Request to a provider
export interface ProviderRequest {
  model: string;
  instructions?: string;
  input: ProviderInputItem[];
  tools?: ToolDefinition[];
  /** Optional JSON-schema structured output constraint. */
  responseFormat?: ResponseFormat;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

// The provider interface every adapter must implement
export interface Provider {
  name: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
}

// Abort helpers
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Operation aborted");
    err.name = "AbortError";
    throw err;
  }
}
