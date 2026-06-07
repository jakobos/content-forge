const encoder = new TextEncoder();

function sseChunk(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Wrap an async iterable of events into a Server-Sent Events Response.
 * Each event is serialised as `data: <json>\n\n`.
 * On completion, emits `data: [DONE]\n\n`.
 */
export function createSSEResponse(events: AsyncIterable<unknown>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(sseChunk(event));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(sseChunk({ type: "error", error: message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Immediate SSE error — sends one error event then closes. */
export function createSSEErrorResponse(error: string): Response {
  const body = encoder.encode(`data: ${JSON.stringify({ type: "error", error })}\n\ndata: [DONE]\n\n`);
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
