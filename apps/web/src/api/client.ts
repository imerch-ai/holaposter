export interface PostDraft {
  id: string;
  content: string;
  status: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8080";

export async function createDraft(content: string): Promise<PostDraft> {
  const response = await fetch(`${API_BASE_URL}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    throw new Error(`create_draft_failed:${response.status}`);
  }

  return (await response.json()) as PostDraft;
}

export async function listPosts(): Promise<PostDraft[]> {
  const response = await fetch(`${API_BASE_URL}/posts`);
  if (!response.ok) {
    throw new Error(`list_posts_failed:${response.status}`);
  }

  return (await response.json()) as PostDraft[];
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
