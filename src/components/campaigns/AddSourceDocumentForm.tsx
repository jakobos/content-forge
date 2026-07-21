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
        "Add Source Document"
      )}
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-input px-3 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring transition-colors text-sm";
const inputErrorClass =
  "w-full rounded-lg border border-destructive/60 bg-input px-3 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-destructive transition-colors text-sm";
const labelClass = "mb-1 block text-sm text-muted-foreground";

export default function AddSourceDocumentForm({ campaignId, serverError }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
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
      <input type="hidden" name="type" value="source_document" />

      <div>
        <label htmlFor="src-title" className={labelClass}>
          Title <span className="text-destructive">*</span>
        </label>
        <input
          id="src-title"
          name="title"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
          }}
          placeholder="e.g. Customer interview — Jane D."
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
        <label htmlFor="src-content" className={labelClass}>
          Content <span className="text-destructive">*</span>
        </label>
        <textarea
          id="src-content"
          name="content"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
          }}
          placeholder="Paste or type the document content here…"
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

      <div>
        <label htmlFor="src-url" className={labelClass}>
          Source URL <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <input
          id="src-url"
          name="source_url"
          type="url"
          value={sourceUrl}
          onChange={(e) => {
            setSourceUrl(e.target.value);
          }}
          placeholder="https://…"
          className={inputClass}
        />
      </div>

      <ServerError message={serverError} />
      <SubmitButton />
    </form>
  );
}
