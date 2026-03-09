import http from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { MetricsClient } from "../metrics/metrics-client";
import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "../routes/posts";
import * as tools from "./tools";

export function buildMcpServer(store: PostStore, queue: PublishQueue, metricsClient: MetricsClient, workspaceId?: string): McpServer {
  const mcp = new McpServer({ name: "postsyncer", version: "1.0.0" });

  mcp.tool("create_post", "Create a new post draft via the workspace draft API", {
    content: z.string().min(1).describe("Post text content"),
    scheduled_at: z.string().optional().describe("ISO 8601 datetime for scheduled publish"),
    provider: z.string().optional().describe("Platform provider: twitter-xdnq | linkedin | reddit (default: twitter-xdnq)")
  }, async ({ content, scheduled_at, provider }) => {
    const post = await tools.createPost({ content, scheduled_at, provider, workspaceId }, store);
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
    const result = await tools.queuePublish({ post_id, workspaceId }, store, queue);
    if (!result) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  mcp.tool("cancel_publish", "Cancel a scheduled post — reverts it to draft status", {
    post_id: z.string()
  }, async ({ post_id }) => {
    const result = await tools.cancelPublish({ post_id, workspaceId }, store);
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

  mcp.tool("get_post_metrics", "Get X/Twitter engagement metrics for a published post (likes, views, retweets, etc.)", {
    post_id: z.string().describe("Internal post ID (must be published with an external_post_id)")
  }, async ({ post_id }) => {
    const result = await tools.getPostMetrics({ post_id }, store, metricsClient);
    if (!result) return { content: [{ type: "text" as const, text: "post not found" }], isError: true };
    if ("error" in result) return { content: [{ type: "text" as const, text: result.error }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  mcp.tool("get_metrics_overview", "Get overall X/Twitter post metrics overview — totals, top posts, best posting hours", {
    time_range: z.enum(["7d", "30d", "90d"]).optional().describe("Time range for stats (default: 7d)")
  }, async ({ time_range }) => {
    const result = await tools.getMetricsOverview({ time_range }, metricsClient);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  return mcp;
}

export function startMcpServer({
  port,
  store,
  queue,
  metricsClient
}: {
  port: number;
  store: PostStore;
  queue: PublishQueue;
  metricsClient: MetricsClient;
}): Promise<http.Server> {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/mcp") {
      const workspaceId = (req.headers["x-workspace-id"] as string) || undefined;
      const mcp = buildMcpServer(store, queue, metricsClient, workspaceId);
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
