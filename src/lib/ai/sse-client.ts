import type { GenerationProgressEvent } from "@/lib/ai/generation/service";

/**
 * Consume a Server-Sent Events response from the generation endpoint.
 * Yields GenerationProgressEvent objects until the stream ends or [DONE] is received.
 *
 * Usage:
 *   const resp = await fetch("/api/ai/generate-ideas", { method: "POST", body: ... });
 *   for await (const event of consumeSSE(resp)) { ... }
 */
export async function* consumeSSE(response: Response): AsyncGenerator<GenerationProgressEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data) as unknown;
          } catch {
            continue;
          }
          if (typeof parsed === "object" && parsed !== null) {
            yield parsed as GenerationProgressEvent;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export type { GenerationProgressEvent };
