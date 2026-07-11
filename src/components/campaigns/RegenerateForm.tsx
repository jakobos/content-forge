import { useRef, useState } from "react";
import { consumeSSE } from "@/lib/ai/sse-client";

interface Props {
  campaignId: string;
  generationNumber: number;
  ideaId?: string;
  label?: string;
}

type FormState = "idle" | "editing" | "generating" | "error";

const PHASE_LABELS: Record<string, string> = {
  retrieving: "Searching documents...",
  generating: "Regenerating ideas...",
  saving: "Saving ideas...",
};

const MAX_HINT_LENGTH = 200;

export default function RegenerateForm({ campaignId, generationNumber, ideaId, label = "Regenerate" }: Props) {
  const [state, setState] = useState<FormState>("idle");
  const [hint, setHint] = useState<string>("");
  const [phase, setPhase] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  async function handleRegenerate() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState("generating");
    setPhase("retrieving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/ai/regenerate-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          generation_number: generationNumber,
          ...(ideaId ? { idea_id: ideaId } : {}),
          ...(hint.trim() ? { hint: hint.trim() } : {}),
        }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      for await (const event of consumeSSE(response)) {
        if (event.type === "error") {
          throw new Error(event.error ?? "Regeneration failed");
        }
        if (event.type === "done") {
          window.location.reload();
          return;
        }
        setPhase(event.type);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMessage(err instanceof Error ? err.message : "Regeneration failed");
      setState("error");
    }
  }

  function handleCancel() {
    setState("idle");
    setHint("");
    setErrorMessage("");
  }

  function handleTryAgain() {
    setState("editing");
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
          onClick={handleTryAgain}
          className="rounded-lg bg-purple-600/20 px-3 py-1.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-600/30"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (state === "editing") {
    const charCount = hint.length;

    return (
      <div className="flex flex-col gap-3">
        <textarea
          value={hint}
          onChange={(e) => {
            setHint(e.target.value.slice(0, MAX_HINT_LENGTH));
          }}
          placeholder="Optional: describe how to improve... (e.g. 'shorter hooks', 'focus on data points')"
          rows={2}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-blue-100/30 focus:ring-1 focus:ring-purple-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-blue-100/40">
            {charCount}/{MAX_HINT_LENGTH}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-blue-100/60 transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void handleRegenerate();
              }}
              className="rounded-lg bg-purple-600/30 px-4 py-1.5 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-600/50"
            >
              Regenerate
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setState("editing");
      }}
      className="rounded-lg bg-purple-600/20 px-3 py-1.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-600/30"
    >
      {label}
    </button>
  );
}
