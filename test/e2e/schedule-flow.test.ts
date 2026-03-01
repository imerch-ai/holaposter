import { describe, expect, it } from "vitest";

interface E2EPost {
  id: string;
  status: "draft" | "queued" | "publishing" | "published" | "failed";
  schedule_cron?: string;
}

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080";
const HOLABOSS_USER_ID = process.env.E2E_HOLABOSS_USER_ID ?? "e2e-user";

async function waitForExecution(postId: string, timeoutMs = 45000): Promise<E2EPost> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${API_BASE_URL}/posts/${postId}`);
    if (response.ok) {
      const post = (await response.json()) as E2EPost;
      if (post.status === "publishing" || post.status === "published" || post.status === "failed") {
        return post;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("scheduled_execution_timeout");
}

describe("e2e schedule flow", () => {
  it("registers repeatable schedule and triggers execution attempt", async () => {
    const createResponse = await fetch(`${API_BASE_URL}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "e2e schedule flow" })
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as E2EPost;

    const scheduleResponse = await fetch(`${API_BASE_URL}/posts/${created.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holaboss_user_id: HOLABOSS_USER_ID, cron: "*/5 * * * * *" })
    });
    expect(scheduleResponse.status).toBe(202);
    const scheduled = (await scheduleResponse.json()) as E2EPost;
    expect(scheduled.schedule_cron).toBe("*/5 * * * * *");

    const attempted = await waitForExecution(created.id);
    expect(["publishing", "published", "failed"]).toContain(attempted.status);
  }, 60000);
});
