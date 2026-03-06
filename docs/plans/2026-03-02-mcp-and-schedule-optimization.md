# MCP Server + Schedule Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a MCP server to the API service so agents can discover and invoke postsyncer capabilities, and fix two schedule design problems: `holaboss_user_id` leaking into request bodies, and missing cancel-schedule support.

**Architecture:** The MCP server runs as a standalone HTTP server on port 3099, started in the same process as the Fastify API. Both share a common `PostStore` singleton. MCP tools map 1:1 to existing API operations. Schedule optimization extracts `holaboss_user_id` from request bodies (reads from env) and adds cancel support.

**Tech Stack:** `@modelcontextprotocol/sdk`, Fastify, BullMQ, Vitest, Zod, TypeScript.

---

## What exists today

- `apps/api/src/routes/publish.ts` — `/posts/:id/publish` and `/posts/:id/schedule`, both accept `holaboss_user_id` in body (problem: should come from env)
- `apps/api/src/queue/bullmq-publish-queue.ts` — `enqueue` + `schedule`, no `unschedule` or `getStats`
- `apps/api/src/queue/publish-queue.ts` — `PublishQueue` interface, no `unschedule`/`getStats`/`close`
- `apps/api/src/domain/types.ts` — `PostRecord`, `PublishQueuePayload`, `PublishJobState`
- PostStore is defined inline in `apps/api/src/routes/posts.ts` and not exported

## What we're adding

1. **Schedule fix:** remove `holaboss_user_id` from request bodies, add cancel endpoint, add `unschedule` to BullMQ
2. **Shared store:** extract PostStore to a singleton so MCP server can share it
3. **MCP server:** standalone HTTP server at `:3099`, tools for all CRUD + publish ops, health check
4. **app.runtime.yaml + schema:** declare `mcp` section in contract

---

## Task 1: Fix Schedule — Remove `holaboss_user_id` From Request Bodies

The `HOLABOSS_USER_ID` env var is already in `env_contract`. Request bodies must not carry it.

**Files:**
- Modify: `apps/api/src/routes/publish.ts`
- Modify: `apps/api/test/publish.test.ts`
- Modify: `apps/api/test/schedule.test.ts`

**Step 1: Update the publish test to not send holaboss_user_id**

In `apps/api/test/publish.test.ts`, remove `holaboss_user_id` from the request body:

```ts
const res = await app.inject({
  method: "POST",
  url: `/posts/${postId}/publish`,
  payload: {} // no holaboss_user_id
});
expect(res.statusCode).toBe(202);
expect(res.json().status).toBe("queued");
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (route still requires `holaboss_user_id`).

**Step 3: Fix the publish route**

In `apps/api/src/routes/publish.ts`:
- Delete `publishBodySchema` (no body needed for immediate publish)
- Delete `scheduleBodySchema.holaboss_user_id` field (cron is still accepted)
- Read `holaboss_user_id` from `process.env.HOLABOSS_USER_ID ?? ""`
- Validate it is non-empty at request time, return 503 if missing

```ts
app.post("/posts/:id/publish", async (request, reply) => {
  const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
  if (!holaboss_user_id) {
    return reply.code(503).send({ error: "HOLABOSS_USER_ID not configured" });
  }
  // ... rest unchanged, use holaboss_user_id from above
});

app.post("/posts/:id/schedule", async (request, reply) => {
  const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
  if (!holaboss_user_id) {
    return reply.code(503).send({ error: "HOLABOSS_USER_ID not configured" });
  }
  const parsedBody = z.object({ cron: z.string().min(1) }).safeParse(request.body);
  // ... cron only, no holaboss_user_id in schema
});
```

**Step 4: Update schedule test similarly**

In `apps/api/test/schedule.test.ts`, remove `holaboss_user_id` from the schedule payload.

**Step 5: Run tests to verify pass**

Run: `npm run test --workspace @postsyncer/api`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/api/src/routes/publish.ts apps/api/test/publish.test.ts apps/api/test/schedule.test.ts
git commit -m "fix: read holaboss_user_id from env, not request body"
```

---

## Task 2: Add `unschedule` and `getStats` to PublishQueue

**Files:**
- Modify: `apps/api/src/queue/publish-queue.ts`
- Modify: `apps/api/src/queue/bullmq-publish-queue.ts`
- Modify: `apps/api/src/routes/publish.ts`
- Modify: `apps/api/test/schedule.test.ts`

**Step 1: Write failing test for cancel schedule**

Add to `apps/api/test/schedule.test.ts`:

```ts
it("cancels a scheduled publish job", async () => {
  const queue: PublishQueue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    unschedule: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ queued: 0, publishing: 0, failed: 0 }),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const app = buildServer({ queue });

  const create = await app.inject({ method: "POST", url: "/posts", payload: { content: "x" } });
  const postId = create.json().id as string;

  const res = await app.inject({ method: "DELETE", url: `/posts/${postId}/schedule` });
  expect(res.statusCode).toBe(200);
  expect(queue.unschedule).toHaveBeenCalledWith(postId);
  await app.close();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (`unschedule` missing, route missing).

**Step 3: Extend PublishQueue interface**

In `apps/api/src/queue/publish-queue.ts`:

```ts
export interface PublishQueue {
  enqueue(payload: PublishQueuePayload): Promise<void>;
  schedule(payload: PublishQueuePayload, cron: string): Promise<void>;
  unschedule(postId: string): Promise<void>;
  getStats(): Promise<{ queued: number; publishing: number; failed: number }>;
  close(): Promise<void>;
}

export class NoopPublishQueue implements PublishQueue {
  async enqueue(_payload: PublishQueuePayload): Promise<void> { return; }
  async schedule(_payload: PublishQueuePayload, _cron: string): Promise<void> { return; }
  async unschedule(_postId: string): Promise<void> { return; }
  async getStats() { return { queued: 0, publishing: 0, failed: 0 }; }
  async close(): Promise<void> { return; }
}
```

**Step 4: Implement in BullMqPublishQueue**

In `apps/api/src/queue/bullmq-publish-queue.ts`:

```ts
async unschedule(postId: string): Promise<void> {
  // BullMQ repeatable jobs are identified by their repeat key.
  // We remove all repeatable jobs whose key starts with the post_id prefix.
  const repeatable = await this.queue.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.key.includes(`schedule:${postId}:`)) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}

async getStats(): Promise<{ queued: number; publishing: number; failed: number }> {
  const counts = await this.queue.getJobCounts("wait", "active", "failed");
  return {
    queued: counts.wait ?? 0,
    publishing: counts.active ?? 0,
    failed: counts.failed ?? 0
  };
}
```

**Step 5: Add DELETE route**

In `apps/api/src/routes/publish.ts`:

```ts
app.delete("/posts/:id/schedule", async (request, reply) => {
  const params = request.params as { id?: string };
  const postId = params.id;
  if (!postId || !store.byId.has(postId)) {
    return reply.code(404).send({ error: "post not found" });
  }
  await queue.unschedule(postId);
  const post = store.byId.get(postId)!;
  post.schedule_cron = undefined;
  post.updated_at = new Date().toISOString();
  return reply.code(200).send({ post_id: postId, schedule_cron: null });
});
```

**Step 6: Run tests to verify pass**

Run: `npm run test --workspace @postsyncer/api`
Expected: PASS.

**Step 7: Commit**

```bash
git add apps/api/src/queue apps/api/src/routes/publish.ts apps/api/test/schedule.test.ts
git commit -m "feat: add unschedule and getStats to publish queue"
```

---

## Task 3: Extract Shared PostStore Singleton

The MCP server will run in the same Node.js process as Fastify and needs access to the same PostStore. Currently PostStore is defined and held inside `buildServer`. We extract it to a module-level singleton.

**Files:**
- Create: `apps/api/src/store/post-store.ts`
- Modify: `apps/api/src/routes/posts.ts`
- Modify: `apps/api/src/server.ts` (or index.ts, wherever buildServer lives — read first)
- Modify: `apps/api/src/index.ts`

**Step 1: Read current posts.ts to understand PostStore shape**

(Read the file before editing. Don't skip this step.)

**Step 2: Write failing test**

Add to `apps/api/test/bootstrap.test.ts`:

```ts
it("shared post store is importable", async () => {
  const { sharedPostStore } = await import("../src/store/post-store");
  expect(sharedPostStore).toBeDefined();
  expect(sharedPostStore.byId).toBeInstanceOf(Map);
});
```

**Step 3: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (module missing).

**Step 4: Create the shared store**

Create `apps/api/src/store/post-store.ts`:

```ts
import type { PostStore } from "../routes/posts";

export const sharedPostStore: PostStore = {
  byId: new Map(),
  list: []
};
```

Update `apps/api/src/routes/posts.ts` and `buildServer` to accept an optional `store` parameter and fall back to `sharedPostStore`. Update `apps/api/src/index.ts` to pass `sharedPostStore` explicitly.

**Step 5: Run tests to verify pass**

Run: `npm run test --workspace @postsyncer/api`
Expected: PASS (existing tests still pass with shared store).

**Step 6: Commit**

```bash
git add apps/api/src/store apps/api/src/routes/posts.ts apps/api/src/index.ts
git commit -m "refactor: extract shared PostStore singleton for MCP access"
```

---

## Task 4: MCP Server — Install SDK and Define Tools

**Files:**
- Modify: `apps/api/package.json` (add `@modelcontextprotocol/sdk`)
- Create: `apps/api/src/mcp/tools.ts`
- Create: `apps/api/src/mcp/server.ts`
- Create: `apps/api/test/mcp-tools.test.ts`

**Step 1: Install MCP SDK**

Run: `npm install @modelcontextprotocol/sdk --workspace @postsyncer/api`

**Step 2: Write failing tool tests**

Create `apps/api/test/mcp-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sharedPostStore } from "../src/store/post-store";
import { createPost, listPosts, getPost, getQueueStats } from "../src/mcp/tools";
import { NoopPublishQueue } from "../src/queue/publish-queue";

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
```

**Step 3: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (tools module missing).

**Step 4: Implement tools**

Create `apps/api/src/mcp/tools.ts`:

```ts
import { nanoid } from "nanoid";
import type { PostStore } from "../routes/posts";
import type { PublishQueue } from "../queue/publish-queue";
import type { PostRecord } from "../domain/types";

export async function createPost(
  { content, scheduled_at }: { content: string; scheduled_at?: string },
  store: PostStore
): Promise<PostRecord> {
  const now = new Date().toISOString();
  const post: PostRecord = {
    id: nanoid(),
    content,
    status: "draft",
    created_at: now,
    updated_at: now,
    ...(scheduled_at ? { scheduled_at } : {})
  };
  store.byId.set(post.id, post);
  store.list.push(post);
  return post;
}

export async function updatePost(
  { post_id, content, scheduled_at }: { post_id: string; content?: string; scheduled_at?: string },
  store: PostStore
): Promise<PostRecord | null> {
  const post = store.byId.get(post_id);
  if (!post) return null;
  if (content !== undefined) post.content = content;
  if (scheduled_at !== undefined) post.scheduled_at = scheduled_at;
  post.updated_at = new Date().toISOString();
  return post;
}

export async function listPosts(
  { status, limit }: { status?: string; limit?: number },
  store: PostStore
): Promise<PostRecord[]> {
  let result = store.list;
  if (status) result = result.filter((p) => p.status === status);
  if (limit) result = result.slice(0, limit);
  return result;
}

export async function getPost(
  { post_id }: { post_id: string },
  store: PostStore
): Promise<PostRecord | null> {
  return store.byId.get(post_id) ?? null;
}

export async function queuePublish(
  { post_id }: { post_id: string },
  store: PostStore,
  queue: PublishQueue
): Promise<{ job_id: string } | null> {
  const post = store.byId.get(post_id);
  if (!post) return null;
  const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
  post.status = "queued";
  post.updated_at = new Date().toISOString();
  await queue.enqueue({ post_id, content: post.content, holaboss_user_id });
  return { job_id: `job:${post_id}` };
}

export async function cancelPublish(
  { post_id }: { post_id: string },
  store: PostStore,
  queue: PublishQueue
): Promise<boolean> {
  const post = store.byId.get(post_id);
  if (!post) return false;
  await queue.unschedule(post_id);
  post.schedule_cron = undefined;
  post.updated_at = new Date().toISOString();
  return true;
}

export async function getPublishStatus(
  { post_id }: { post_id: string },
  store: PostStore
): Promise<{ status: string; error?: string; published_at?: string } | null> {
  const post = store.byId.get(post_id);
  if (!post) return null;
  return {
    status: post.status,
    ...(post.error_message ? { error: post.error_message } : {}),
    ...(post.status === "published" ? { published_at: post.updated_at } : {})
  };
}

export async function getQueueStats(queue: PublishQueue) {
  return queue.getStats();
}
```

**Step 5: Run tests to verify pass**

Run: `npm run test --workspace @postsyncer/api`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/api/src/mcp/tools.ts apps/api/test/mcp-tools.test.ts apps/api/package.json
git commit -m "feat: add MCP tool handlers for postsyncer operations"
```

---

## Task 5: MCP HTTP Server

**Files:**
- Create: `apps/api/src/mcp/server.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/mcp-server.test.ts`

**Step 1: Write failing test**

Create `apps/api/test/mcp-server.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("MCP health endpoint", () => {
  it("GET /mcp/health returns ok", async () => {
    const port = 13099;
    const { startMcpServer } = await import("../src/mcp/server");
    const { NoopPublishQueue } = await import("../src/queue/publish-queue");
    const { sharedPostStore } = await import("../src/store/post-store");

    const server = await startMcpServer({ port, store: sharedPostStore, queue: new NoopPublishQueue() });
    const res = await fetch(`http://127.0.0.1:${port}/mcp/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    server.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (`startMcpServer` missing).

**Step 3: Implement MCP server**

Create `apps/api/src/mcp/server.ts`:

```ts
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { PostStore } from "../routes/posts";
import type { PublishQueue } from "../queue/publish-queue";
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
    status: z.enum(["draft", "queued", "publishing", "published", "failed"]).optional(),
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

  mcp.tool("cancel_publish", "Cancel scheduled or queued publish for a post", {
    post_id: z.string()
  }, async ({ post_id }) => {
    const ok = await tools.cancelPublish({ post_id }, store, queue);
    return { content: [{ type: "text" as const, text: ok ? "cancelled" : "post not found" }], isError: !ok };
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
    const url = new URL(req.url ?? "/", `http://localhost`);

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
```

**Step 4: Start MCP server from index.ts**

In `apps/api/src/index.ts`, after starting Fastify:

```ts
import { startMcpServer } from "./mcp/server";
import { sharedPostStore } from "./store/post-store";

// in start():
const mcpPort = Number(process.env.MCP_PORT ?? "3099");
const mcpServer = await startMcpServer({ port: mcpPort, store: sharedPostStore, queue });
console.info("postsyncer_mcp_started", { port: mcpPort });

// in shutdown():
mcpServer.close();
```

**Step 5: Run tests to verify pass**

Run: `npm run test --workspace @postsyncer/api`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/api/src/mcp/server.ts apps/api/src/index.ts apps/api/test/mcp-server.test.ts
git commit -m "feat: add MCP HTTP server with all postsyncer tools"
```

---

## Task 6: Update Runtime Contract

**Files:**
- Modify: `packages/runtime-contract/src/schema.ts`
- Modify: `app.runtime.yaml`
- Modify: `packages/runtime-contract/test/runtime-contract.test.ts`

**Step 1: Write failing test**

Add to `packages/runtime-contract/test/runtime-contract.test.ts`:

```ts
it("loads mcp config when present", async () => {
  const contract = await loadRuntimeContract(process.cwd() + "/app.runtime.yaml");
  expect(contract.mcp?.enabled).toBe(true);
  expect(contract.mcp?.port).toBe(3099);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/runtime-contract`
Expected: FAIL (schema does not have `mcp` field).

**Step 3: Add mcp to schema**

In `packages/runtime-contract/src/schema.ts`, add optional `mcp` section:

```ts
const mcpSchema = z.object({
  enabled: z.boolean(),
  transport: z.literal("http-sse"),
  port: z.number().int().positive(),
  path: z.string().min(1)
}).optional();

// In runtimeContractSchema:
export const runtimeContractSchema = z.object({
  // ... existing fields ...
  mcp: mcpSchema
});
```

**Step 4: Update app.runtime.yaml**

```yaml
mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp

healthchecks:
  # add:
  mcp:
    path: /mcp/health
    timeout_s: 10
```

Also update the healthchecks schema to make `mcp` optional.

**Step 5: Run tests to verify pass**

Run: `npm run test --workspace @postsyncer/runtime-contract`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/runtime-contract app.runtime.yaml
git commit -m "feat: add mcp section to runtime contract schema and app.runtime.yaml"
```

---

## Verification Checklist

- `npm run test` passes across all workspaces.
- `POST /posts/:id/publish` no longer accepts `holaboss_user_id` in body.
- `DELETE /posts/:id/schedule` removes the BullMQ repeatable job.
- MCP server responds to `GET :3099/mcp/health` with `{"ok": true}`.
- `tools/list` on MCP returns 8 tools with correct names and schemas.
- `app.runtime.yaml` validates against updated schema (mcp section present).

## Notes

- Keep `NoopPublishQueue` in sync with the full `PublishQueue` interface at all times.
- MCP server is stateless per request — `sessionIdGenerator: undefined` is correct for MVP.
- Do not add DB persistence in this plan; that is a separate migration task.
- Use `@superpowers:verification-before-completion` before claiming done.
