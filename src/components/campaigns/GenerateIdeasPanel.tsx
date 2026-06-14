import { useRef, useState } from "react";
import { consumeSSE } from "@/lib/ai/sse-client";

interface Props {
  campaignId: string;
  hasDocuments: boolean;
}

type PanelState = "idle" | "generating" | "error";

const PHASE_LABELS: Record<string, string> = {
  retrieving: "Searching documents...",
  generating: "Generating ideas...",
  saving: "Saving ideas...",
};

export default function GenerateIdeasPanel({ campaignId, hasDocuments }: Props) {
  const [state, setState] = useState<PanelState>("idle");
  const [batchSize, setBatchSize] = useState(5);
  const [phase, setPhase] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  async function handleGenerate() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState("generating");
    setPhase("retrieving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/ai/generate-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, batch_size: batchSize }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      for await (const event of consumeSSE(response)) {
        if (event.type === "error") {
          throw new Error(event.error ?? "Generation failed");
        }
        if (event.type === "done") {
          window.location.reload();
          return;
        }
        setPhase(event.type);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMessage(err instanceof Error ? err.message : "Generation failed");
      setState("error");
    }
  }

  function handleReset() {
    setState("idle");
    setPhase("");
    setErrorMessage("");
  }

  if (state === "generating") {
    return (
      <div className="flex items-center gap-3 text-sm text-blue-100/70">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
        <span>{PHASE_LABELS[phase] ?? "Processing..."}</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-red-300">{errorMessage}</p>
        <button
          onClick={handleReset}
          className="rounded-lg bg-purple-600/20 px-3 py-1.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-600/30"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="batch-size" className="text-sm text-blue-100/70">
        Ideas:
      </label>
      <select
        id="batch-size"
        value={batchSize}
        onChange={(e) => {
          setBatchSize(Number(e.target.value));
        }}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          void handleGenerate();
        }}
        disabled={!hasDocuments}
        title={!hasDocuments ? "Add documents first" : undefined}
        className="rounded-lg bg-purple-600/30 px-4 py-1.5 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-600/50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {hasDocuments ? "Generate Ideas" : "Add documents first"}
      </button>
    </div>
  );
}
