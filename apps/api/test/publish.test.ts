import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server";

describe("POST /posts/:id/publish", () => {
  it("queues publish job and returns queued", async () => {
    const app = buildServer();
    const create = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { content: "hello x" }
    });
    const postId = create.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/posts/${postId}/publish`,
      payload: { holaboss_user_id: "u1" }
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("queued");
    await app.close();
  });
});
