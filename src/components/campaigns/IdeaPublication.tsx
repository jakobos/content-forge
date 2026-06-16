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
    <div className="border-t border-white/10 pt-4">
      <p className="mb-2 text-xs font-medium tracking-wide text-blue-100/40 uppercase">Publication</p>

      {!showForm && publication && (
        <div className="space-y-1">
          {publication.url && (
            <a
              href={publication.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm text-purple-300 hover:underline"
            >
              {publication.url}
            </a>
          )}
          {publication.platform_name && (
            <p className="text-sm text-blue-100/70">
              <span className="text-blue-100/40">Platform: </span>
              {publication.platform_name}
            </p>
          )}
          {publication.published_at && (
            <p className="text-sm text-blue-100/70">
              <span className="text-blue-100/40">Published: </span>
              {new Date(publication.published_at).toLocaleDateString()}
            </p>
          )}
          {publication.note && <p className="text-sm text-blue-100/70 italic">{publication.note}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={openForm}
              disabled={inFlight}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-blue-100/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={() => {
                void handleRemove();
              }}
              disabled={inFlight}
              className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {inFlight ? "Removing..." : "Remove"}
            </button>
          </div>
          {errorMsg && <p className="mt-1 text-xs text-red-400">{errorMsg}</p>}
        </div>
      )}

      {!showForm && !publication && (
        <div>
          <button onClick={openForm} className="text-sm text-purple-300 transition-colors hover:text-purple-100">
            + Add publication details
          </button>
          {errorMsg && <p className="mt-1 text-xs text-red-400">{errorMsg}</p>}
        </div>
      )}

      {showForm && (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
          <div>
            <label className="block text-xs text-blue-100/50">
              URL
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
                placeholder="https://example.com/article"
                className="mt-1 block w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-blue-100/30 focus:border-purple-500/50 focus:outline-none"
              />
            </label>
          </div>
          <div>
            <label className="block text-xs text-blue-100/50">
              Platform
              <input
                type="text"
                value={platformName}
                onChange={(e) => {
                  setPlatformName(e.target.value);
                }}
                placeholder="e.g. LinkedIn, Medium, YouTube"
                maxLength={200}
                className="mt-1 block w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-blue-100/30 focus:border-purple-500/50 focus:outline-none"
              />
            </label>
          </div>
          <div>
            <label className="block text-xs text-blue-100/50">
              Publish date
              <input
                type="date"
                value={publishedAt}
                onChange={(e) => {
                  setPublishedAt(e.target.value);
                }}
                className="mt-1 block rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-purple-500/50 focus:outline-none"
              />
            </label>
          </div>
          <div>
            <label className="block text-xs text-blue-100/50">
              Note
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                rows={2}
                maxLength={2000}
                placeholder="Optional note"
                className="mt-1 block w-full resize-none rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-blue-100/30 focus:border-purple-500/50 focus:outline-none"
              />
            </label>
          </div>
          {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={inFlight}
              className="rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-300 transition-colors hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {inFlight ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={inFlight}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-blue-100/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
