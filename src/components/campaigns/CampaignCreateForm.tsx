import { useState } from "react";
import { useFormStatus } from "react-dom";
import { ServerError } from "@/components/auth/ServerError";
import { CircleAlert } from "lucide-react";

interface Props {
  serverError?: string | null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Creating…
        </span>
      ) : (
        "Create Campaign"
      )}
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors";

const inputErrorClass =
  "w-full rounded-lg border border-red-400/60 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors";

const labelClass = "mb-1 block text-sm text-blue-100/80";

export default function CampaignCreateForm({ serverError }: Props) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [description, setDescription] = useState("");
  const [titleError, setTitleError] = useState<string | undefined>();

  function validate() {
    if (!title.trim()) {
      setTitleError("Title is required");
      return false;
    }
    setTitleError(undefined);
    return true;
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/campaigns" className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="title" className={labelClass}>
          Title <span className="text-red-400">*</span>
        </label>
        <input
          id="title"
          name="title"
          aria-label="Title"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError(undefined);
          }}
          placeholder="e.g. Q3 Content Push"
          className={titleError ? inputErrorClass : inputClass}
          autoFocus
        />
        {titleError && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
            <CircleAlert className="size-3" />
            {titleError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="goal" className={labelClass}>
          Goal <span className="text-blue-100/40">(optional)</span>
        </label>
        <input
          id="goal"
          name="goal"
          type="text"
          value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
          }}
          placeholder="e.g. Drive awareness among mid-market CFOs"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description <span className="text-blue-100/40">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          placeholder="Any additional context about this campaign…"
          rows={4}
          className={inputClass}
        />
      </div>

      <ServerError message={serverError} />

      <SubmitButton />
    </form>
  );
}
