import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server";

describe("POST /internal/job-states", () => {
  it("updates post status to published", async () => {
    const app = buildServer();
    const create = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { content: "hello x" }
    });
    const postId = create.json().id as string;

    const update = await app.inject({
      method: "POST",
      url: "/internal/job-states",
      payload: {
        post_id: postId,
        holaboss_user_id: "u1",
        status: "published",
        external_post_id: "x-post-1"
      }
    });

    const post = await app.inject({
      method: "GET",
      url: `/posts/${postId}`
    });

    expect(update.statusCode).toBe(200);
    expect(post.statusCode).toBe(200);
    expect(post.json().status).toBe("published");
    expect(post.json().external_post_id).toBe("x-post-1");
    await app.close();
  });
});
