import { useRef, useState } from "react";
import { consumeSSE } from "@/lib/ai/sse-client";

interface Props {
  campaignId: string;
  hasDocuments: boolean;
}

type PanelState = "idle" | "composing" | "generating" | "error";

const PHASE_LABELS: Record<string, string> = {
  retrieving: "Searching documents...",
  generating: "Generating ideas...",
  saving: "Saving ideas...",
};

const MIN_DESCRIPTION_LENGTH = 20;
const MAX_DESCRIPTION_LENGTH = 2000;

export default function GenerateIdeasPanel({ campaignId, hasDocuments }: Props) {
  const [state, setState] = useState<PanelState>("idle");
  const [batchSize, setBatchSize] = useState(5);
  const [phase, setPhase] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  // Track which state to return to when the user clicks "Try Again"
  const [retryState, setRetryState] = useState<"idle" | "composing">("idle");
  const abortRef = useRef<AbortController | null>(null);

  async function handleGenerate() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState("generating");
    setPhase("retrieving");
    setErrorMessage("");
    setRetryState("idle");

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

  async function handleStructure() {
    const trimmed = description.trim();
    if (trimmed.length < MIN_DESCRIPTION_LENGTH) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState("generating");
    setPhase("retrieving");
    setErrorMessage("");
    setRetryState("composing");

    try {
      const response = await fetch("/api/ai/structure-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, description: trimmed }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      for await (const event of consumeSSE(response)) {
        if (event.type === "error") {
          throw new Error(event.error ?? "Structuring failed");
        }
        if (event.type === "done") {
          window.location.reload();
          return;
        }
        setPhase(event.type);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMessage(err instanceof Error ? err.message : "Structuring failed");
      setState("error");
    }
  }

  function handleReset() {
    setState(retryState);
    setPhase("");
    setErrorMessage("");
  }

  if (state === "generating") {
    return (
      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <span className="border-primary inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
        <span>{PHASE_LABELS[phase] ?? "Processing..."}</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-destructive text-sm">{errorMessage}</p>
        <button
          onClick={handleReset}
          className="bg-primary/20 text-primary hover:bg-primary/30 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (state === "composing") {
    const charCount = description.length;
    const isSubmittable = description.trim().length >= MIN_DESCRIPTION_LENGTH;

    return (
      <div className="flex flex-col gap-3">
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH));
          }}
          placeholder="Describe your idea in your own words… (min 20 characters)"
          rows={4}
          className="border-input bg-input text-foreground placeholder:text-muted-foreground/50 focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground/50 text-xs">
            {charCount}/{MAX_DESCRIPTION_LENGTH}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setState("idle");
              }}
              className="bg-card/50 text-muted-foreground hover:bg-card/70 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void handleStructure();
              }}
              disabled={!isSubmittable}
              title={!isSubmittable ? `Minimum ${MIN_DESCRIPTION_LENGTH} characters required` : undefined}
              className="bg-primary/30 text-primary-foreground hover:bg-primary/50 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Structure Idea
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="batch-size" className="text-muted-foreground text-sm">
        Ideas:
      </label>
      <select
        id="batch-size"
        value={batchSize}
        onChange={(e) => {
          setBatchSize(Number(e.target.value));
        }}
        className="border-input bg-input text-foreground focus:ring-ring rounded-lg border px-2 py-1 text-sm focus:ring-1 focus:outline-none"
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
        className="bg-primary/30 text-primary-foreground hover:bg-primary/50 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {hasDocuments ? "Generate Ideas" : "Add documents first"}
      </button>
      <button
        onClick={() => {
          setState("composing");
        }}
        disabled={!hasDocuments}
        title={!hasDocuments ? "Add documents first" : undefined}
        className="bg-primary/30 text-primary-foreground hover:bg-primary/50 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        Describe your own idea
      </button>
    </div>
  );
}
