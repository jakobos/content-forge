import { useState } from "react";
import { nextStatuses, IDEA_STATUS_LABEL, IDEA_STATUS_CLASS } from "@/lib/ideas/lifecycle";
import type { IdeaStatus } from "@/lib/ideas/lifecycle";
import { ideaToMarkdown } from "@/lib/ideas/markdown";
import type { IdeaForMarkdown, FragmentRef } from "@/lib/ideas/markdown";

interface Props {
  ideaId: string;
  initialStatus: IdeaStatus;
  idea: IdeaForMarkdown;
  refs: FragmentRef[];
}

type UIState = "idle" | "copying" | "copied" | "error";

export default function IdeaActions({ ideaId, initialStatus, idea, refs }: Props) {
  const [status, setStatus] = useState<IdeaStatus>(initialStatus);
  const [inFlight, setInFlight] = useState(false);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const canCopy = status === "accepted" || status === "published";
  const actions = nextStatuses(status);

  async function handleTransition(e: React.MouseEvent, target: IdeaStatus) {
    e.stopPropagation();
    if (inFlight) return;

    const previous = status;
    setStatus(target); // optimistic
    setInFlight(true);
    setUiState("idle");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/ideas/${ideaId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      // Reload when the transition crosses the published boundary so the
      // SSR-rendered publication section appears or disappears correctly.
      if (previous === "published" || target === "published") {
        window.location.reload();
        return;
      }
    } catch (err) {
      setStatus(previous); // rollback
      setErrorMsg(err instanceof Error ? err.message : "Update failed");
      setUiState("error");
    } finally {
      setInFlight(false);
    }
  }

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (inFlight) return;

    setUiState("copying");
    try {
      const md = ideaToMarkdown(idea, refs);
      await navigator.clipboard.writeText(md);
      setUiState("copied");
      setTimeout(() => {
        setUiState("idle");
      }, 2000);
    } catch {
      setErrorMsg("Copy failed");
      setUiState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status badge */}
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${IDEA_STATUS_CLASS[status]}`}>
        {IDEA_STATUS_LABEL[status]}
      </span>

      {/* Transition buttons */}
      {actions.map((target) => (
        <button
          key={target}
          onClick={(e) => {
            void handleTransition(e, target);
          }}
          disabled={inFlight}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-blue-100/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {IDEA_STATUS_LABEL[target]}
        </button>
      ))}

      {/* Copy button */}
      {canCopy && (
        <button
          onClick={(e) => {
            void handleCopy(e);
          }}
          disabled={inFlight || uiState === "copying"}
          className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300 transition-colors hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {uiState === "copied" ? "Copied!" : uiState === "copying" ? "Copying..." : "Copy"}
        </button>
      )}

      {/* Inline error feedback */}
      {uiState === "error" && (
        <span
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="text-xs text-red-400"
        >
          {errorMsg}
        </span>
      )}
    </div>
  );
}
