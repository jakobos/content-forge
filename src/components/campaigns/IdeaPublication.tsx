import { useState } from "react";
import type { IdeaStatus } from "@/lib/ideas/lifecycle";
import type { PublicationInput, PublicationRow } from "@/lib/ideas/publication";

interface Props {
  ideaId: string;
  status: IdeaStatus;
  publication: PublicationRow | null;
}

export default function IdeaPublication({ ideaId, status, publication }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Form field state — pre-filled from existing publication when editing
  const [url, setUrl] = useState(publication?.url ?? "");
  const [platformName, setPlatformName] = useState(publication?.platform_name ?? "");
  const [publishedAt, setPublishedAt] = useState(
    publication?.published_at ? publication.published_at.slice(0, 10) : "",
  );
  const [note, setNote] = useState(publication?.note ?? "");

  // Gate: only show for published ideas
  if (status !== "published") {
    return null;
  }

  function openForm() {
    // Re-sync form fields from current publication before opening
    setUrl(publication?.url ?? "");
    setPlatformName(publication?.platform_name ?? "");
    setPublishedAt(publication?.published_at ? publication.published_at.slice(0, 10) : "");
    setNote(publication?.note ?? "");
    setErrorMsg("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setErrorMsg("");
  }

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault();
    if (inFlight) return;
    setInFlight(true);
    setErrorMsg("");

    try {
      const body: PublicationInput = {
        url: url || undefined,
        platform_name: platformName || undefined,
        published_at: publishedAt || undefined,
        note: note || undefined,
      };

      const res = await fetch(`/api/ideas/${ideaId}/publication`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      window.location.reload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setInFlight(false);
    }
  }

  async function handleRemove() {
    if (inFlight) return;
    setInFlight(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/ideas/${ideaId}/publication`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      window.location.reload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Remove failed");
      setInFlight(false);
    }
  }

  return (
    <div className="border-border border-t pt-4">
      <p className="text-muted-foreground/50 mb-2 text-xs font-medium tracking-wide uppercase">Publication</p>

      {!showForm && publication && (
        <div className="space-y-1">
          {publication.url && (
            <a
              href={publication.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary block truncate text-sm hover:underline"
            >
              {publication.url}
            </a>
          )}
          {publication.platform_name && (
            <p className="text-muted-foreground text-sm">
              <span className="text-muted-foreground/50">Platform: </span>
              {publication.platform_name}
            </p>
          )}
          {publication.published_at && (
            <p className="text-muted-foreground text-sm">
              <span className="text-muted-foreground/50">Published: </span>
              {new Date(publication.published_at).toLocaleDateString()}
            </p>
          )}
          {publication.note && <p className="text-muted-foreground text-sm italic">{publication.note}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={openForm}
              disabled={inFlight}
              className="border-border bg-card/50 text-muted-foreground hover:bg-card/70 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={() => {
                void handleRemove();
              }}
              disabled={inFlight}
              className="border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {inFlight ? "Removing..." : "Remove"}
            </button>
          </div>
          {errorMsg && <p className="text-destructive mt-1 text-xs">{errorMsg}</p>}
        </div>
      )}

      {!showForm && !publication && (
        <div>
          <button onClick={openForm} className="text-primary hover:text-primary/80 text-sm transition-colors">
            + Add publication details
          </button>
          {errorMsg && <p className="text-destructive mt-1 text-xs">{errorMsg}</p>}
        </div>
      )}

      {showForm && (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
          <div>
            <label className="text-muted-foreground/60 block text-xs">
              URL
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
                placeholder="https://example.com/article"
                className="border-input bg-input text-foreground placeholder:text-muted-foreground/50 focus:border-ring/50 mt-1 block w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
              />
            </label>
          </div>
          <div>
            <label className="text-muted-foreground/60 block text-xs">
              Platform
              <input
                type="text"
                value={platformName}
                onChange={(e) => {
                  setPlatformName(e.target.value);
                }}
                placeholder="e.g. LinkedIn, Medium, YouTube"
                maxLength={200}
                className="border-input bg-input text-foreground placeholder:text-muted-foreground/50 focus:border-ring/50 mt-1 block w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
              />
            </label>
          </div>
          <div>
            <label className="text-muted-foreground/60 block text-xs">
              Publish date
              <input
                type="date"
                value={publishedAt}
                onChange={(e) => {
                  setPublishedAt(e.target.value);
                }}
                className="border-input bg-input text-foreground focus:border-ring/50 mt-1 block rounded-md border px-3 py-1.5 text-sm focus:outline-none"
              />
            </label>
          </div>
          <div>
            <label className="text-muted-foreground/60 block text-xs">
              Note
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                rows={2}
                maxLength={2000}
                placeholder="Optional note"
                className="border-input bg-input text-foreground placeholder:text-muted-foreground/50 focus:border-ring/50 mt-1 block w-full resize-none rounded-md border px-3 py-1.5 text-sm focus:outline-none"
              />
            </label>
          </div>
          {errorMsg && <p className="text-destructive text-xs">{errorMsg}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={inFlight}
              className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 rounded-md border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {inFlight ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={inFlight}
              className="border-border bg-card/50 text-muted-foreground hover:bg-card/70 rounded-md border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
