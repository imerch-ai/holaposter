export type PostStatus = "draft" | "queued" | "publishing" | "published" | "failed";

export interface PostRecord {
  id: string;
  content: string;
  status: PostStatus;
  created_at: string;
  updated_at: string;
  schedule_cron?: string;
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

export async function publishDraft(postId: string, holabossUserId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/posts/${postId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holaboss_user_id: holabossUserId })
  });

  if (!response.ok) {
    throw new Error(`publish_failed:${response.status}`);
  }
}

export async function scheduleDraft(postId: string, holabossUserId: string, cron: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/posts/${postId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holaboss_user_id: holabossUserId, cron })
  });

  if (!response.ok) {
    throw new Error(`schedule_failed:${response.status}`);
  }
}
