import { describe, expect, it } from "vitest";

import { NoopPublishQueue } from "../src/queue/publish-queue";
import { sharedPostStore } from "../src/store/post-store";
import { createPost, getQueueStats, listPosts } from "../src/mcp/tools";

describe("MCP tools", () => {
  const queue = new NoopPublishQueue();

  it("create_post returns a post with draft status", async () => {
    const result = await createPost({ content: "hello mcp" }, sharedPostStore);
    expect(result.status).toBe("draft");
    expect(result.id).toBeTruthy();
  });

  it("list_posts returns created posts", async () => {
    const posts = await listPosts({}, sharedPostStore);
    expect(Array.isArray(posts)).toBe(true);
  });

  it("get_queue_stats returns counts", async () => {
    const stats = await getQueueStats(queue);
    expect(stats).toHaveProperty("queued");
    expect(stats).toHaveProperty("publishing");
    expect(stats).toHaveProperty("failed");
  });
});
