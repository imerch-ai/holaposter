export type PostStatus = "draft" | "queued" | "publishing" | "scheduled" | "published" | "failed";

export interface PostRecord {
  id: string;
  content: string;
  status: PostStatus;
  created_at: string;
  updated_at: string;
  scheduled_at?: string;
  external_post_id?: string;
  error_code?: string;
  error_message?: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8080";

export async function createDraft(content: string): Promise<PostRecord> {
  const response = await fetch(`${API_BASE_URL}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    throw new Error(`create_draft_failed:${response.status}`);
  }

  return (await response.json()) as PostRecord;
}

export async function listPosts(): Promise<PostRecord[]> {
  const response = await fetch(`${API_BASE_URL}/posts`);
  if (!response.ok) {
    throw new Error(`list_posts_failed:${response.status}`);
  }
  return (await response.json()) as PostRecord[];
}

export async function publishDraft(postId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/posts/${postId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`publish_failed:${response.status}:${body}`);
  }
}

export async function scheduleDraft(postId: string, scheduledAt: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/posts/${postId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduled_at: scheduledAt })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`schedule_failed:${response.status}:${body}`);
  }
}
