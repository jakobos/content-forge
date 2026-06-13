import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderOutputItem,
  ProviderInputItem,
  ToolDefinition,
  Content,
} from "../types";
import { throwIfAborted, isAbortError } from "../types";

export interface OpenRouterConfig {
  apiKey: string;
  /** Provider name in the registry (default: "openrouter") */
  name?: string;
  /** Base URL override (default: "https://openrouter.ai/api/v1") */
  baseUrl?: string;
  /** Default model when none specified */
  defaultModel?: string;
}

// ---- Local raw API types (OpenRouter Responses API shapes) ----

interface ORContentItem {
  type: string;
  text?: string;
  annotations?: unknown[];
}

interface ORMessageOutputItem {
  type: "message";
  id?: string;
  role?: string;
  status?: string;
  content?: ORContentItem[];
}

interface ORFunctionCallOutputItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
}

interface ORReasoningOutputItem {
  type: "reasoning";
  id?: string;
  summary?: string[];
  encrypted_content?: string;
}

type OROutputItem = ORMessageOutputItem | ORFunctionCallOutputItem | ORReasoningOutputItem;

interface ORUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface ORFullResponse {
  id: string;
  model?: string;
  output: OROutputItem[];
  usage?: ORUsage;
  status?: string;
}

// ---- Safe property access helpers for SSE event parsing ----

function recStr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function recRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = obj[key];
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

// ---- Input mapping: our types → OpenRouter input array ----

function contentToInputText(content: Content): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function mapInputItems(items: ProviderInputItem[]): unknown[] {
  const result: unknown[] = [];

  for (const item of items) {
    if (item.type === "reasoning") {
      // Reasoning is not passed back to OpenRouter
      continue;
    }

    if (item.type === "message") {
      const text = contentToInputText(item.content);
      if (item.role === "user" || item.role === "system") {
        result.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: item.role === "system" ? `[System]: ${text}` : text }],
        });
      } else {
        // assistant
        result.push({
          type: "message",
          role: "assistant",
          id: `msg_${crypto.randomUUID()}`,
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        });
      }
    } else if (item.type === "function_call") {
      result.push({
        type: "function_call",
        id: `fc_${crypto.randomUUID()}`,
        call_id: item.callId,
        name: item.name,
        arguments: JSON.stringify(item.arguments),
      });
    } else {
      // function_result
      result.push({
        type: "function_call_output",
        id: `fo_${crypto.randomUUID()}`,
        call_id: item.callId,
        output: item.output,
      });
    }
  }

  return result;
}

function mapTools(tools?: ToolDefinition[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: t.strict ?? null,
  }));
}

function buildRequestBody(request: ProviderRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: mapInputItems(request.input),
    stream,
  };
  if (request.instructions) body.instructions = request.instructions;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
  const tools = mapTools(request.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  // Structured-output: wire response_format when caller requests schema-constrained JSON.
  // Verified: OpenRouter /responses endpoint honours response_format.type="json_schema"
  // for supported models (e.g. openai/gpt-4o-mini). If the model does not support it,
  // the generation service falls back to prompt-instructed JSON + server-side Zod parse
  // with one auto-retry (see src/lib/ai/generation/service.ts).
  if (request.responseFormat) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.responseFormat.jsonSchema.name,
        strict: request.responseFormat.jsonSchema.strict ?? true,
        schema: request.responseFormat.jsonSchema.schema,
      },
    };
  }
  return body;
}

// ---- Output mapping: OpenRouter response → our types ----

function mapOutputItem(item: OROutputItem): ProviderOutputItem | null {
  if (item.type === "message") {
    const text = item.content?.find((c) => c.type === "output_text")?.text ?? "";
    return text ? { type: "text", text } : null;
  }
  if (item.type === "function_call") {
    return {
      type: "function_call",
      callId: item.call_id,
      name: item.name,
      arguments: safeParseJson(item.arguments),
    };
  }
  // reasoning (only remaining discriminant after message + function_call)
  const text = item.summary?.join("\n") ?? "";
  return { type: "reasoning", text, provider: "openrouter" };
}

function mapFullResponse(raw: ORFullResponse, request: ProviderRequest): ProviderResponse {
  const output: ProviderOutputItem[] = [];
  for (const item of raw.output) {
    const mapped = mapOutputItem(item);
    if (mapped) output.push(mapped);
  }
  const hasFunctionCalls = output.some((o) => o.type === "function_call");
  return {
    id: raw.id,
    model: raw.model ?? request.model,
    output,
    usage: raw.usage
      ? {
          inputTokens: raw.usage.input_tokens,
          outputTokens: raw.usage.output_tokens,
          totalTokens: raw.usage.total_tokens,
        }
      : undefined,
    finishReason: hasFunctionCalls ? "tool_calls" : "stop",
  };
}

// ---- Factory ----

export function createOpenRouterProvider(config: OpenRouterConfig): Provider {
  const providerName = config.name ?? "openrouter";
  const baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
  const authHeaders = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  async function generate(request: ProviderRequest): Promise<ProviderResponse> {
    throwIfAborted(request.signal);
    const body = buildRequestBody(request, false);
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errText}`);
    }
    const rawBody: unknown = (await response.json()) as unknown;
    const raw = rawBody as ORFullResponse;
    return mapFullResponse(raw, request);
  }

  async function* streamImpl(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent> {
    throwIfAborted(request.signal);
    const body = buildRequestBody(request, true);
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!response.ok) {
      const errText = await response.text();
      yield { type: "error", error: `OpenRouter error ${response.status}: ${errText}` };
      return;
    }
    if (!response.body) {
      yield { type: "error", error: "No response body" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Streaming accumulation state
    let accumulatedText = "";
    let accumulatedReasoning = "";
    interface FcState {
      callId: string;
      name: string;
      argBuffer: string;
    }
    const fcStates = new Map<string, FcState>();
    const outputItems: ProviderOutputItem[] = [];
    let responseId = "";
    let responseModel = request.model;
    let usage: ProviderResponse["usage"] | undefined;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;

          let eventRaw: unknown;
          try {
            eventRaw = JSON.parse(data) as unknown;
          } catch {
            continue;
          }
          if (typeof eventRaw !== "object" || eventRaw === null) continue;
          const ev = eventRaw as Record<string, unknown>;

          const type = ev.type;
          if (typeof type !== "string") continue;

          if (type === "response.created") {
            const resp = recRecord(ev, "response");
            if (resp) {
              responseId = recStr(resp, "id") || responseId;
              responseModel = recStr(resp, "model") || responseModel;
            }
          } else if (type === "response.content_part.delta") {
            const delta = recStr(ev, "delta");
            if (delta) {
              accumulatedText += delta;
              yield { type: "text_delta", delta };
            }
          } else if (type === "response.output_item.added") {
            const item = recRecord(ev, "item");
            if (item) {
              const itemType = recStr(item, "type");
              if (itemType === "function_call") {
                const callId = recStr(item, "call_id");
                const fcName = recStr(item, "name");
                if (callId) {
                  fcStates.set(callId, { callId, name: fcName, argBuffer: "" });
                }
              }
            }
          } else if (type === "response.function_call_arguments.delta") {
            const callId = recStr(ev, "call_id");
            const delta = recStr(ev, "delta");
            if (callId && delta) {
              const state = fcStates.get(callId);
              if (state) {
                state.argBuffer += delta;
                yield { type: "function_call_delta", callId, name: state.name, argumentsDelta: delta };
              }
            }
          } else if (type === "response.function_call_arguments.done") {
            const callId = recStr(ev, "call_id");
            const rawArgs = recStr(ev, "arguments");
            const state = fcStates.get(callId);
            if (state) {
              const args = safeParseJson(rawArgs || state.argBuffer);
              const fcItem: ProviderOutputItem = {
                type: "function_call",
                callId,
                name: state.name,
                arguments: args,
              };
              outputItems.push(fcItem);
              yield { type: "function_call_done", callId, name: state.name, arguments: args };
            }
          } else if (type === "response.output_item.done") {
            const item = recRecord(ev, "item");
            if (item) {
              const itemType = recStr(item, "type");
              if (itemType === "message" && accumulatedText.length > 0) {
                outputItems.push({ type: "text", text: accumulatedText });
                yield { type: "text_done", text: accumulatedText };
                accumulatedText = "";
              } else if (itemType === "reasoning" && accumulatedReasoning.length > 0) {
                outputItems.push({ type: "reasoning", text: accumulatedReasoning, provider: "openrouter" });
                yield { type: "reasoning_done", text: accumulatedReasoning };
                accumulatedReasoning = "";
              }
            }
          } else if (type === "response.reasoning.delta") {
            const delta = recStr(ev, "delta");
            if (delta) {
              accumulatedReasoning += delta;
              yield { type: "reasoning_delta", delta };
            }
          } else if (type === "response.done") {
            const resp = recRecord(ev, "response");
            if (resp) {
              responseId = recStr(resp, "id") || responseId;
              responseModel = recStr(resp, "model") || responseModel;
              const usageRaw = recRecord(resp, "usage");
              if (usageRaw) {
                const inputTokens = usageRaw.input_tokens;
                const outputTokens = usageRaw.output_tokens;
                const totalTokens = usageRaw.total_tokens;
                usage = {
                  inputTokens: typeof inputTokens === "number" ? inputTokens : 0,
                  outputTokens: typeof outputTokens === "number" ? outputTokens : 0,
                  totalTokens: typeof totalTokens === "number" ? totalTokens : 0,
                };
              }
            }
            const hasFunctionCalls = outputItems.some((o) => o.type === "function_call");
            const finalResponse: ProviderResponse = {
              id: responseId,
              model: responseModel,
              output: outputItems,
              usage,
              finishReason: hasFunctionCalls ? "tool_calls" : "stop",
            };
            yield { type: "done", response: finalResponse };
            return;
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: "error", error: "Request aborted" };
      } else {
        yield {
          type: "error",
          error: err instanceof Error ? err.message : "Stream error",
        };
      }
    } finally {
      reader.releaseLock();
    }
  }

  return {
    name: providerName,
    generate,
    stream: streamImpl,
  };
}
