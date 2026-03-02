import { describe, expect, it, vi } from "vitest";

import type { PublishQueue } from "../src/queue/publish-queue";
import { buildServer } from "../src/server";

describe("POST /posts/:id/schedule", () => {
  it("registers repeatable publish job", async () => {
    process.env.HOLABOSS_USER_ID = "u1";
    const queue: PublishQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined)
    };
    const app = buildServer({ queue });

    const create = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { content: "hello schedule" }
    });
    const postId = create.json().id as string;

    const res = await app.inject({
      method: "POST",
      url: `/posts/${postId}/schedule`,
      payload: {
        cron: "*/1 * * * * *"
      }
    });

    expect(res.statusCode).toBe(202);
    expect(queue.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        post_id: postId,
        holaboss_user_id: "u1"
      }),
      "*/1 * * * * *"
    );
    await app.close();
  });
});
