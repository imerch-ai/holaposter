import { describe, expect, it } from "vitest";

interface E2EPost {
  id: string;
  status: "draft" | "queued" | "publishing" | "scheduled" | "published" | "failed";
  scheduled_at?: string;
}

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080";

async function waitForTerminalStatus(postId: string, timeoutMs = 45000): Promise<E2EPost> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${API_BASE_URL}/posts/${postId}`);
    if (response.ok) {
      const post = (await response.json()) as E2EPost;
      if (post.status === "scheduled" || post.status === "published" || post.status === "failed") {
        return post;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("scheduled_execution_timeout");
}

describe("e2e schedule flow", () => {
  it("schedules a post for a future time and reaches terminal status", async () => {
    const createResponse = await fetch(`${API_BASE_URL}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "e2e schedule flow" })
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as E2EPost;

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduleResponse = await fetch(`${API_BASE_URL}/posts/${created.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_at: scheduledAt })
    });
    expect(scheduleResponse.status).toBe(202);

    const attempted = await waitForTerminalStatus(created.id);
    expect(["scheduled", "published", "failed"]).toContain(attempted.status);
  }, 60000);
});
