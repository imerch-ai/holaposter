import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server";

describe("POST /posts/:id/publish", () => {
  it("queues publish job and returns queued", async () => {
    process.env.HOLABOSS_USER_ID = "u1";
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
      payload: {}
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("queued");
    await app.close();
  });
});
