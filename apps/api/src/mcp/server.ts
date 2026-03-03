import http from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "../routes/posts";
import * as tools from "./tools";

export function buildMcpServer(store: PostStore, queue: PublishQueue): McpServer {
  const mcp = new McpServer({ name: "postsyncer", version: "1.0.0" });

  mcp.tool("create_post", "Create a new post draft", {
    content: z.string().min(1).describe("Post text content"),
    scheduled_at: z.string().optional().describe("ISO 8601 datetime for one-time scheduled publish")
  }, async ({ content, scheduled_at }) => {
    const post = await tools.createPost({ content, scheduled_at }, store);
    return { content: [{ type: "text" as const, text: JSON.stringify(post) }] };
  });

  mcp.tool("update_post", "Update content or schedule of an existing post", {
    post_id: z.string().describe("ID of the post to update"),
    content: z.string().optional().describe("New post content"),
    scheduled_at: z.string().optional().describe("New ISO 8601 scheduled datetime")
  }, async ({ post_id, content, scheduled_at }) => {
    const post = await tools.updatePost({ post_id, content, scheduled_at }, store);
    if (!post) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(post) }] };
  });

  mcp.tool("list_posts", "List posts, optionally filtered by status", {
    status: z.enum(["draft", "queued", "publishing", "scheduled", "published", "failed"]).optional(),
    limit: z.number().int().positive().optional()
  }, async ({ status, limit }) => {
    const posts = await tools.listPosts({ status, limit }, store);
    return { content: [{ type: "text" as const, text: JSON.stringify(posts) }] };
  });

  mcp.tool("get_post", "Get a single post by ID", {
    post_id: z.string()
  }, async ({ post_id }) => {
    const post = await tools.getPost({ post_id }, store);
    if (!post) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(post) }] };
  });

  mcp.tool("queue_publish", "Queue a post for immediate publishing to X", {
    post_id: z.string()
  }, async ({ post_id }) => {
    const result = await tools.queuePublish({ post_id }, store, queue);
    if (!result) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  mcp.tool("cancel_publish", "Cancel a scheduled post — reverts it to draft status", {
    post_id: z.string()
  }, async ({ post_id }) => {
    const result = await tools.cancelPublish({ post_id }, store);
    if (!result) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: !result.cancelled };
  });

  mcp.tool("get_publish_status", "Get current publish status for a post", {
    post_id: z.string()
  }, async ({ post_id }) => {
    const status = await tools.getPublishStatus({ post_id }, store);
    if (!status) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(status) }] };
  });

  mcp.tool("get_queue_stats", "Get current queue statistics (queued, publishing, failed counts)", {}, async () => {
    const stats = await tools.getQueueStats(queue);
    return { content: [{ type: "text" as const, text: JSON.stringify(stats) }] };
  });

  return mcp;
}

export function startMcpServer({
  port,
  store,
  queue
}: {
  port: number;
  store: PostStore;
  queue: PublishQueue;
}): Promise<http.Server> {
  const mcp = buildMcpServer(store, queue);

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/mcp") {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => void transport.close());
      await mcp.connect(transport);

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
        await transport.handleRequest(req, res, body);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => resolve(httpServer));
  });
}
