import { describe, expect, it, vi } from "vitest";

import type { PublishQueue } from "../src/queue/publish-queue";
import { buildServer } from "../src/server";

describe("POST /posts/:id/schedule", () => {
  it("enqueues a one-time job with scheduled_at", async () => {
    process.env.HOLABOSS_USER_ID = "u1";
    const queue: PublishQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({ queued: 0, publishing: 0, failed: 0 }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const app = buildServer({ queue });

    const create = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { content: "scheduled content" }
    });
    const postId = create.json().id as string;

    const scheduledAt = "2026-03-15T14:00:00.000Z";
    const res = await app.inject({
      method: "POST",
      url: `/posts/${postId}/schedule`,
      payload: { scheduled_at: scheduledAt }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().scheduled_at).toBe(scheduledAt);
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        post_id: postId,
        holaboss_user_id: "u1",
        scheduled_at: scheduledAt
      })
    );
    await app.close();
  });

  it("returns 400 when scheduled_at is missing", async () => {
    const app = buildServer();
    const create = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { content: "x" }
    });
    const postId = create.json().id as string;

    const res = await app.inject({
      method: "POST",
      url: `/posts/${postId}/schedule`,
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
