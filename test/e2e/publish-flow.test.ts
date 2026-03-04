import { describe, expect, it } from "vitest";

interface E2EPost {
  id: string;
  status: "draft" | "queued" | "publishing" | "scheduled" | "published" | "failed";
  external_post_id?: string;
  error_code?: string;
}

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080";

async function waitForTerminalStatus(postId: string, timeoutMs = 30000): Promise<E2EPost> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${API_BASE_URL}/posts/${postId}`);
    if (response.ok) {
      const post = (await response.json()) as E2EPost;
      if (post.status === "published" || post.status === "failed") {
        return post;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("terminal_status_timeout");
}

describe("e2e publish flow", () => {
  it("creates draft and reaches terminal publish status", async () => {
    const createResponse = await fetch(`${API_BASE_URL}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "e2e publish flow" })
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as E2EPost;

    const publishResponse = await fetch(`${API_BASE_URL}/posts/${created.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    expect(publishResponse.status).toBe(202);

    const finalPost = await waitForTerminalStatus(created.id);
    expect(["published", "failed"]).toContain(finalPost.status);
    if (finalPost.status === "published") {
      expect(finalPost.external_post_id).toBeTruthy();
    } else {
      expect(finalPost.error_code).toBeTruthy();
    }
  });
});
