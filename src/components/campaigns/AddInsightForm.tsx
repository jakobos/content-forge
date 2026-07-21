import { useState } from "react";
import { useFormStatus } from "react-dom";
import { ServerError } from "@/components/auth/ServerError";
import { CircleAlert } from "lucide-react";

interface Props {
  campaignId: string;
  serverError?: string | null;
}

const MAX_CONTENT = 20_000;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
          Adding…
        </span>
      ) : (
        "Add Insight"
      )}
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-input px-3 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring transition-colors text-sm";
const inputErrorClass =
  "w-full rounded-lg border border-destructive/60 bg-input px-3 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-destructive transition-colors text-sm";
const labelClass = "mb-1 block text-sm text-muted-foreground";

export default function AddInsightForm({ campaignId, serverError }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!title.trim()) next.title = "Title is required";
    if (!content.trim()) next.content = "Content is required";
    else if (content.length > MAX_CONTENT)
      next.content = `Content must be ${MAX_CONTENT.toLocaleString()} characters or fewer`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    if (!validate()) e.preventDefault();
  }

  const overLimit = content.length > MAX_CONTENT;

  return (
    <form
      method="POST"
      action={`/api/campaigns/${campaignId}/documents`}
      className="space-y-4"
      onSubmit={handleSubmit}
      noValidate
    >
      <input type="hidden" name="type" value="user_insight" />

      <div>
        <label htmlFor="insight-title" className={labelClass}>
          Title <span className="text-destructive">*</span>
        </label>
        <input
          id="insight-title"
          name="title"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
          }}
          placeholder="e.g. Key pain point from user research"
          className={errors.title ? inputErrorClass : inputClass}
        />
        {errors.title && (
          <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
            <CircleAlert className="size-3" />
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="insight-content" className={labelClass}>
          Content <span className="text-destructive">*</span>
        </label>
        <textarea
          id="insight-content"
          name="content"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
          }}
          placeholder="Describe the insight in detail…"
          rows={8}
          maxLength={MAX_CONTENT}
          className={errors.content ? inputErrorClass : inputClass}
        />
        <div className="mt-1 flex items-center justify-between">
          {errors.content ? (
            <p className="text-destructive flex items-center gap-1 text-xs">
              <CircleAlert className="size-3" />
              {errors.content}
            </p>
          ) : (
            <span />
          )}
          <span className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground/50"}`}>
            {content.length.toLocaleString()} / {MAX_CONTENT.toLocaleString()}
          </span>
        </div>
      </div>

      <ServerError message={serverError} />
      <SubmitButton />
    </form>
  );
}
