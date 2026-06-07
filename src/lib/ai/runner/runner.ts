import type { ProviderInputItem, ProviderOutputItem, ProviderResponse, ProviderUsage } from "@/lib/ai/providers";
import { resolveProvider } from "@/lib/ai/providers";
import type {
  AgentRunnerConfig,
  AgentRunnerContext,
  AgentRunnerResult,
  RunnerStreamEvent,
  ToolCallLogEntry,
} from "./types";

const DEFAULT_MAX_ROUND_TRIPS = 10;

/**
 * Create an agent runner bound to the given config and context.
 * Returns a `run()` method that accepts initial input and yields
 * `RunnerStreamEvent` items while orchestrating the LLM + tool loop.
 */
export function createAgentRunner(config: AgentRunnerConfig, context: AgentRunnerContext) {
  const maxRoundTrips = config.maxRoundTrips ?? DEFAULT_MAX_ROUND_TRIPS;

  async function* run(initialInput: ProviderInputItem[]): AsyncGenerator<RunnerStreamEvent> {
    // Resolve provider from "provider:model" string
    const resolved = resolveProvider(config.model);
    if (!resolved) {
      yield { type: "runner_error", error: `Unknown model: ${config.model}` };
      return;
    }
    const { provider, model } = resolved;

    // Tool definitions to expose to the LLM
    const toolDefs = config.tools ?? context.toolRegistry.list();

    const conversationHistory: ProviderInputItem[] = [...initialInput];
    const toolCallsLog: ToolCallLogEntry[] = [];
    const accumulatedUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let roundTrips = 0;
    let finalOutput: ProviderOutputItem[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      // On the final allowed round-trip, omit tools to force a text response
      const isLastAllowed = roundTrips >= maxRoundTrips - 1;
      const requestTools = isLastAllowed ? undefined : toolDefs.length > 0 ? toolDefs : undefined;

      yield { type: "round_trip_start", roundTrip: roundTrips + 1 };

      const request = {
        model,
        instructions: config.systemInstructions,
        input: conversationHistory,
        tools: requestTools,
        temperature: config.temperature,
      };

      // Stream from provider and capture the final ProviderResponse
      let doneResponse: ProviderResponse | undefined;
      const stream = provider.stream(request);

      for await (const event of stream) {
        yield event;
        if (event.type === "done") {
          doneResponse = event.response;
        } else if (event.type === "error") {
          yield { type: "runner_error", error: event.error };
          return;
        }
      }

      if (!doneResponse) {
        yield { type: "runner_error", error: "Provider stream ended without a done event" };
        return;
      }

      // Accumulate usage
      if (doneResponse.usage) {
        accumulatedUsage.inputTokens += doneResponse.usage.inputTokens;
        accumulatedUsage.outputTokens += doneResponse.usage.outputTokens;
        accumulatedUsage.totalTokens += doneResponse.usage.totalTokens;
        if (doneResponse.usage.cachedTokens) {
          accumulatedUsage.cachedTokens = (accumulatedUsage.cachedTokens ?? 0) + doneResponse.usage.cachedTokens;
        }
      }

      finalOutput = doneResponse.output;
      roundTrips++;

      yield { type: "round_trip_end", roundTrip: roundTrips };

      // Extract function calls from the response output
      const functionCalls = doneResponse.output.filter(
        (o): o is Extract<(typeof doneResponse.output)[number], { type: "function_call" }> =>
          o.type === "function_call",
      );

      // No function calls → natural completion
      if (functionCalls.length === 0) break;

      // Already hit the round-trip limit (forced text-only last request) → stop
      if (roundTrips >= maxRoundTrips) break;

      // Append assistant's function_call items to conversation history
      for (const fc of functionCalls) {
        conversationHistory.push({
          type: "function_call",
          callId: fc.callId,
          name: fc.name,
          arguments: fc.arguments,
        });
      }

      // Execute each tool and append results to the conversation
      for (const fc of functionCalls) {
        yield {
          type: "tool_call_start",
          callId: fc.callId,
          name: fc.name,
          arguments: fc.arguments,
        };

        const result = await context.toolRegistry.execute(fc.name, fc.arguments);

        yield { type: "tool_call_end", callId: fc.callId, name: fc.name, result };

        toolCallsLog.push({
          callId: fc.callId,
          name: fc.name,
          arguments: fc.arguments,
          result,
        });

        conversationHistory.push({
          type: "function_result",
          callId: fc.callId,
          name: fc.name,
          output: result.ok ? result.output : `Error: ${result.error}`,
        });
      }

      // If the response also had text output, add it as an assistant message for context
      const textContent = doneResponse.output
        .filter((o): o is Extract<(typeof doneResponse.output)[number], { type: "text" }> => o.type === "text")
        .map((o) => o.text)
        .join("");

      if (textContent.length > 0) {
        conversationHistory.push({ type: "message", role: "assistant", content: textContent });
      }
    }

    const runnerResult: AgentRunnerResult = {
      output: finalOutput,
      usage: accumulatedUsage,
      roundTrips,
      toolCalls: toolCallsLog,
    };

    yield { type: "runner_done", result: runnerResult };
  }

  return { run };
}
