import React, { useState } from "react";

interface PostComposerProps {
  onCreateDraft: (content: string) => Promise<void>;
}

export function PostComposer({ onCreateDraft }: PostComposerProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <section>
      <h2>Create Draft</h2>
      <textarea
        aria-label="draft-content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={5}
      />
      <button
        type="button"
        disabled={submitting || content.trim().length === 0}
        onClick={async () => {
          setSubmitting(true);
          try {
            await onCreateDraft(content.trim());
            setContent("");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Creating..." : "Create Draft"}
      </button>
    </section>
  );
}
