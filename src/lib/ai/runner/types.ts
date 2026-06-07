import type { Provider, ProviderOutputItem, ProviderStreamEvent, ProviderUsage } from "@/lib/ai/providers";
import type { FunctionTool } from "@/lib/ai/tools/types";
import type { ToolRegistry, ToolResult } from "@/lib/ai/tools";

export interface AgentRunnerConfig {
  /** "provider:model" string, e.g. "openrouter:anthropic/claude-sonnet-4-20250514" */
  model: string;
  /** Maximum LLM round-trips before forcing a final text-only response (default: 10) */
  maxRoundTrips?: number;
  /** Sampling temperature */
  temperature?: number;
  /** System-level instructions passed as the `instructions` field */
  systemInstructions?: string;
  /**
   * Tool definitions to expose to the LLM.
   * Defaults to all tools in context.toolRegistry when omitted.
   */
  tools?: FunctionTool[];
}

export interface AgentRunnerContext {
  provider: Provider;
  toolRegistry: ToolRegistry;
  /** Optional — available for future use or per-request tool injection. */
  userId?: string;
}

export interface ToolCallLogEntry {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: ToolResult;
}

export interface AgentRunnerResult {
  /** All output items from the final LLM response. */
  output: ProviderOutputItem[];
  /** Accumulated token usage across all round-trips. */
  usage: ProviderUsage;
  /** Number of LLM round-trips consumed. */
  roundTrips: number;
  /** Log of every tool call made during the run. */
  toolCalls: ToolCallLogEntry[];
}

// Additional lifecycle events emitted by the runner (on top of ProviderStreamEvent)
export type RunnerLifecycleEvent =
  | { type: "tool_call_start"; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_call_end"; callId: string; name: string; result: ToolResult }
  | { type: "round_trip_start"; roundTrip: number }
  | { type: "round_trip_end"; roundTrip: number }
  | { type: "runner_done"; result: AgentRunnerResult }
  | { type: "runner_error"; error: string };

/** All events the runner can emit — provider events pass through plus runner lifecycle events. */
export type RunnerStreamEvent = ProviderStreamEvent | RunnerLifecycleEvent;
