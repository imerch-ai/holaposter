# Platform-Native Scheduling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace BullMQ cron-based scheduling with the platform's native `scheduledDate` API — `POST /posts/:id/schedule` now accepts `{ scheduled_at: ISO datetime }`, enqueues a one-time job, and the worker creates a draft + sets `scheduledDate` on it; the platform publishes at the right time.

**Architecture:** `schedule()` and `unschedule()` are removed from the `PublishQueue` interface. A single `enqueue()` path handles both immediate and scheduled publishing, distinguished by the presence of `scheduled_at` in the payload. The worker branches on `scheduled_at`: if present, call `PUT /api/posts/drafts/{id}` with `scheduledDate`; if absent, call `/api/posts/drafts/{id}/publish` (existing flow unchanged).

**Tech Stack:** Fastify, BullMQ, Vitest, Zod, TypeScript. No new dependencies.

---

## What exists today (read before editing)

- `apps/api/src/domain/types.ts` — `PostStatus`, `PostRecord`, `PublishQueuePayload`, `PublishJobState`
- `apps/api/src/queue/publish-queue.ts` — `PublishQueue` interface + `NoopPublishQueue`
- `apps/api/src/queue/bullmq-publish-queue.ts` — `BullMqPublishQueue`
- `apps/api/src/routes/publish.ts` — `POST /publish`, `POST /schedule`, `DELETE /schedule`
- `apps/api/src/mcp/tools.ts` — `cancelPublish` calls `queue.unschedule()`
- `apps/api/src/mcp/server.ts` — `cancel_publish` tool registered (8 tools total)
- `apps/api/src/server.ts` — CORS methods include `DELETE`
- `apps/api/src/routes/internal-job-states.ts` — validates status enum
- `apps/worker/src/integration/x-publisher.ts` — `publishToX()` always creates draft + publishes
- `apps/worker/src/pipeline/process-publish-job.ts` — `PublishJobPayload`, `processPublishJob`
- `apps/worker/test/x-publisher.test.ts` — tests for immediate publish only
- `apps/worker/test/process-publish-job.test.ts` — tests for immediate publish only
- `apps/api/test/schedule.test.ts` — tests cron-based schedule + cancel

---

## Task 1: Update domain types

**Files:**
- Modify: `apps/api/src/domain/types.ts`

**Step 1: Make the changes**

Replace the entire file content with:

```ts
export type PostStatus = "draft" | "queued" | "publishing" | "scheduled" | "published" | "failed";

export interface PostRecord {
  id: string;
  content: string;
  status: PostStatus;
  created_at: string;
  updated_at: string;
  external_post_id?: string;
  error_code?: string;
  error_message?: string;
  scheduled_at?: string;
}

export interface PublishQueuePayload {
  post_id: string;
  content: string;
  holaboss_user_id: string;
  scheduled_at?: string;
}

export interface PublishJobState {
  post_id: string;
  holaboss_user_id: string;
  status: Exclude<PostStatus, "draft" | "queued">;
  error_code?: string;
  error_message?: string;
  external_post_id?: string;
}
```

Key changes: added `"scheduled"` to `PostStatus`; added `scheduled_at?` to `PublishQueuePayload`; removed `schedule_cron` from `PostRecord`.

**Step 2: Run tests to see what breaks**

```bash
npm run test --workspace @postsyncer/api
npm run test --workspace @postsyncer/worker
```

Expected: some failures — that's the guide for the next tasks.

---

## Task 2: Strip `schedule`/`unschedule` from PublishQueue

**Files:**
- Modify: `apps/api/src/queue/publish-queue.ts`
- Modify: `apps/api/src/queue/bullmq-publish-queue.ts`

**Step 1: Update `publish-queue.ts`**

Replace with:

```ts
import type { PublishQueuePayload } from "../domain/types";

export interface PublishQueue {
  enqueue(payload: PublishQueuePayload): Promise<void>;
  getStats(): Promise<{ queued: number; publishing: number; failed: number }>;
  close(): Promise<void>;
}

export class NoopPublishQueue implements PublishQueue {
  async enqueue(_payload: PublishQueuePayload): Promise<void> {
    return;
  }

  async getStats(): Promise<{ queued: number; publishing: number; failed: number }> {
    return { queued: 0, publishing: 0, failed: 0 };
  }

  async close(): Promise<void> {
    return;
  }
}
```

**Step 2: Update `bullmq-publish-queue.ts`**

Remove the `schedule()` and `unschedule()` methods. Final file:

```ts
import { Queue } from "bullmq";

import type { PublishQueuePayload } from "../domain/types";
import type { PublishQueue } from "./publish-queue";

const queueName = process.env.PUBLISH_QUEUE_NAME ?? "publish_queue";
const redisHost = process.env.REDIS_HOST ?? "127.0.0.1";
const redisPort = Number(process.env.REDIS_PORT ?? "6379");

export class BullMqPublishQueue implements PublishQueue {
  private readonly queue: Queue<PublishQueuePayload>;

  constructor() {
    this.queue = new Queue<PublishQueuePayload>(queueName, {
      connection: { host: redisHost, port: redisPort },
      defaultJobOptions: {
        attempts: Number(process.env.PUBLISH_RETRY_ATTEMPTS ?? "5"),
        backoff: {
          type: "exponential",
          delay: Number(process.env.PUBLISH_RETRY_BACKOFF_MS ?? "1000")
        }
      }
    });
  }

  async enqueue(payload: PublishQueuePayload): Promise<void> {
    await this.queue.add("publish_post", payload);
  }

  async getStats(): Promise<{ queued: number; publishing: number; failed: number }> {
    const counts = await this.queue.getJobCounts("wait", "active", "failed");
    return {
      queued: counts.wait ?? 0,
      publishing: counts.active ?? 0,
      failed: counts.failed ?? 0
    };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
```

**Step 3: Run tests**

```bash
npm run test --workspace @postsyncer/api
```

Expected: schedule.test.ts fails (references removed methods). Others may also fail — continue to fix in subsequent tasks.

**Step 4: Commit**

```bash
git add apps/api/src/queue/
git commit -m "refactor: remove schedule/unschedule from PublishQueue interface"
```

---

## Task 3: Rewrite the schedule route

**Files:**
- Modify: `apps/api/src/routes/publish.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/schedule.test.ts`

**Step 1: Rewrite `schedule.test.ts`**

Replace the entire file:

```ts
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
```

**Step 2: Run test to confirm it fails**

```bash
npm run test --workspace @postsyncer/api -- --reporter=verbose 2>&1 | grep -A5 schedule
```

Expected: FAIL (route still expects `cron`).

**Step 3: Rewrite `publish.ts`**

Replace the entire file:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "./posts";

const scheduleBodySchema = z.object({
  scheduled_at: z.string().datetime()
});

export async function registerPublishRoutes(
  app: FastifyInstance,
  store: PostStore,
  queue: PublishQueue
): Promise<void> {
  app.post("/posts/:id/publish", async (request, reply) => {
    const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
    if (!holaboss_user_id) {
      return reply.code(503).send({ error: "HOLABOSS_USER_ID not configured" });
    }

    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }

    const post = store.byId.get(postId)!;
    post.status = "queued";
    post.updated_at = new Date().toISOString();

    await queue.enqueue({
      post_id: post.id,
      content: post.content,
      holaboss_user_id
    });

    return reply.code(202).send({ post_id: post.id, status: post.status });
  });

  app.post("/posts/:id/schedule", async (request, reply) => {
    const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
    if (!holaboss_user_id) {
      return reply.code(503).send({ error: "HOLABOSS_USER_ID not configured" });
    }

    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }

    const parsedBody = scheduleBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "scheduled_at is required and must be an ISO datetime" });
    }

    const post = store.byId.get(postId)!;
    post.status = "queued";
    post.scheduled_at = parsedBody.data.scheduled_at;
    post.updated_at = new Date().toISOString();

    await queue.enqueue({
      post_id: post.id,
      content: post.content,
      holaboss_user_id,
      scheduled_at: parsedBody.data.scheduled_at
    });

    return reply.code(202).send({
      post_id: post.id,
      status: post.status,
      scheduled_at: post.scheduled_at
    });
  });
}
```

**Step 4: Remove `DELETE` from CORS in `server.ts`**

In `apps/api/src/server.ts`, change:

```ts
methods: ["GET", "POST", "DELETE", "OPTIONS"],
```

to:

```ts
methods: ["GET", "POST", "OPTIONS"],
```

**Step 5: Run tests**

```bash
npm run test --workspace @postsyncer/api
```

Expected: schedule.test.ts passes. Other failures may remain in mcp-tools.test.ts — fix in next task.

**Step 6: Commit**

```bash
git add apps/api/src/routes/publish.ts apps/api/src/server.ts apps/api/test/schedule.test.ts
git commit -m "feat: replace cron schedule with platform-native scheduled_at"
```

---

## Task 4: Update MCP tools and server

**Files:**
- Modify: `apps/api/src/mcp/tools.ts`
- Modify: `apps/api/src/mcp/server.ts`
- Modify: `apps/api/test/mcp-tools.test.ts`
- Modify: `apps/api/test/mcp-server.test.ts`

**Step 1: Remove `cancelPublish` from `tools.ts`**

Delete the `cancelPublish` function entirely. Also update `queuePublish` — it no longer needs to call `unschedule`. Final relevant section of `tools.ts` (remove these lines):

```ts
// DELETE this entire function:
export async function cancelPublish(
  { post_id }: { post_id: string },
  store: PostStore,
  queue: PublishQueue  // <-- also remove PublishQueue import if no longer used elsewhere
): Promise<boolean> { ... }
```

The `PublishQueue` import in tools.ts is still needed for `getQueueStats`. Keep it.

**Step 2: Update `mcp/server.ts`** — remove the `cancel_publish` tool registration (the block starting with `mcp.tool("cancel_publish", ...)`). Tool count drops from 8 to 7.

**Step 3: Update `test/mcp-tools.test.ts`** — remove the import and test for `cancelPublish`:

```ts
// Remove from imports:
import { createPost, getQueueStats, listPosts } from "../src/mcp/tools";
// (cancelPublish already removed)

// No test changes needed — cancelPublish test wasn't in the file
```

(If `cancelPublish` was imported, remove it.)

**Step 4: Update `test/mcp-server.test.ts`** — the health test doesn't check tool count, so no change needed there.

**Step 5: Update smoke test tool count**

In `scripts/smoke-runtime.sh`, change:

```bash
[ "$TOOLS_N" -eq 8 ]
```

to:

```bash
[ "$TOOLS_N" -eq 7 ]
```

**Step 6: Run tests**

```bash
npm run test --workspace @postsyncer/api
```

Expected: all 12 tests pass (schedule test count may change — verify).

**Step 7: Commit**

```bash
git add apps/api/src/mcp/ apps/api/test/mcp-tools.test.ts apps/api/test/mcp-server.test.ts scripts/smoke-runtime.sh
git commit -m "refactor: remove cancel_publish MCP tool, drop to 7 tools"
```

---

## Task 5: Update internal-job-states route

**Files:**
- Modify: `apps/api/src/routes/internal-job-states.ts`
- Modify: `apps/api/test/internal-job-states.test.ts`

**Step 1: Add `"scheduled"` to the status enum in the route**

In `apps/api/src/routes/internal-job-states.ts`, change:

```ts
status: z.enum(["publishing", "published", "failed"]),
```

to:

```ts
status: z.enum(["publishing", "scheduled", "published", "failed"]),
```

**Step 2: Run tests**

```bash
npm run test --workspace @postsyncer/api
```

Expected: all pass.

**Step 3: Commit**

```bash
git add apps/api/src/routes/internal-job-states.ts
git commit -m "feat: add scheduled status to internal job state endpoint"
```

---

## Task 6: Update worker — x-publisher

**Files:**
- Modify: `apps/worker/src/integration/x-publisher.ts`
- Modify: `apps/worker/test/x-publisher.test.ts`

**Step 1: Write failing test for scheduled publish**

Add to `apps/worker/test/x-publisher.test.ts`:

```ts
it("creates draft then sets scheduledDate when scheduled_at is provided", async () => {
  process.env.WORKSPACE_API_URL = "http://workspace-api:3033";
  process.env.WORKSPACE_X_INTEGRATION_ID = "integration-1";

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ postId: "draft-1" })
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    });

  vi.stubGlobal("fetch", fetchMock);

  const publisher = new PlatformXPublisher();
  const result = await publisher.publishToX({
    holaboss_user_id: "u1",
    content: "scheduled post",
    scheduled_at: "2026-03-15T14:00:00.000Z"
  });

  // First call: create draft
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "http://workspace-api:3033/api/posts/drafts?userId=u1",
    expect.objectContaining({ method: "POST" })
  );
  // Second call: set scheduledDate (not /publish)
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "http://workspace-api:3033/api/posts/drafts/draft-1?userId=u1",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ scheduledDate: "2026-03-15T14:00:00.000Z" })
    })
  );
  expect(result).toEqual({ external_post_id: "draft-1" });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test --workspace @postsyncer/worker
```

Expected: FAIL (publishToX always calls `/publish`, ignores `scheduled_at`).

**Step 3: Update `PublishToXInput` and `publishToX()`**

In `apps/worker/src/integration/x-publisher.ts`:

1. Add `scheduled_at?: string` to `PublishToXInput`:

```ts
export interface PublishToXInput {
  holaboss_user_id: string;
  content: string;
  scheduled_at?: string;
}
```

2. After getting `draftId`, branch on `scheduled_at`:

```ts
if (input.scheduled_at) {
  // Platform-native scheduling: set scheduledDate, platform handles publish
  const scheduleResponse = await fetch(
    `${this.workspaceApiUrl}/api/posts/drafts/${draftId}?userId=${encodeURIComponent(input.holaboss_user_id)}`,
    {
      method: "PUT",
      headers: this.buildHeaders(),
      body: JSON.stringify({ scheduledDate: input.scheduled_at })
    }
  );

  if (!scheduleResponse.ok) {
    const body = await scheduleResponse.text();
    throw new Error(`x_publish_failed:set_schedule:${scheduleResponse.status}:${body}`);
  }

  return { external_post_id: draftId };
}

// Immediate publish (existing flow)
const publishResponse = await fetch(`${this.workspaceApiUrl}/api/posts/drafts/${draftId}/publish`, {
  ...
});
```

**Step 4: Run tests**

```bash
npm run test --workspace @postsyncer/worker
```

Expected: all 4 tests pass (3 existing + 1 new).

**Step 5: Commit**

```bash
git add apps/worker/src/integration/x-publisher.ts apps/worker/test/x-publisher.test.ts
git commit -m "feat: use platform scheduledDate for one-time scheduled publishing"
```

---

## Task 7: Update worker — process-publish-job

**Files:**
- Modify: `apps/worker/src/pipeline/process-publish-job.ts`
- Modify: `apps/worker/test/process-publish-job.test.ts`

**Step 1: Write failing test for scheduled path**

Add to `apps/worker/test/process-publish-job.test.ts`:

```ts
it("schedules on platform and marks job scheduled", async () => {
  const publish = vi.fn().mockResolvedValue({ external_post_id: "draft-1" });
  const save = vi.fn().mockResolvedValue(undefined);

  await processPublishJob(
    { post_id: "p1", holaboss_user_id: "u1", content: "hello", scheduled_at: "2026-03-15T14:00:00.000Z" },
    { publishToX: publish, saveJobState: save }
  );

  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({ scheduled_at: "2026-03-15T14:00:00.000Z" })
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ status: "scheduled" })
  );
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test --workspace @postsyncer/worker
```

Expected: FAIL (`PublishJobPayload` has no `scheduled_at`, status is always `"published"`).

**Step 3: Update `process-publish-job.ts`**

```ts
export interface PublishJobPayload {
  post_id: string;
  holaboss_user_id: string;
  content: string;
  scheduled_at?: string;
}

export async function processPublishJob(
  payload: PublishJobPayload,
  deps: ProcessPublishDependencies
): Promise<void> {
  await deps.saveJobState({
    post_id: payload.post_id,
    holaboss_user_id: payload.holaboss_user_id,
    status: "publishing"
  });

  try {
    const result = await deps.publishToX({
      holaboss_user_id: payload.holaboss_user_id,
      content: payload.content,
      scheduled_at: payload.scheduled_at
    });

    const finalStatus = payload.scheduled_at ? "scheduled" : "published";

    await deps.saveJobState({
      post_id: payload.post_id,
      holaboss_user_id: payload.holaboss_user_id,
      status: finalStatus,
      external_post_id: result.external_post_id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    await deps.saveJobState({
      post_id: payload.post_id,
      holaboss_user_id: payload.holaboss_user_id,
      status: "failed",
      error_code: "x_publish_failed",
      error_message: message
    });
    throw error;
  }
}
```

**Step 4: Run all tests**

```bash
npm run test
```

Expected: all workspaces pass.

**Step 5: Verify TypeScript build**

```bash
npm run build --workspace @postsyncer/api
npm run build --workspace @postsyncer/worker
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/worker/src/pipeline/process-publish-job.ts apps/worker/test/process-publish-job.test.ts
git commit -m "feat: pass scheduled_at through pipeline, report status as scheduled"
```

---

## Verification Checklist

- `npm run test` passes across all workspaces.
- `npm run build --workspace @postsyncer/api && npm run build --workspace @postsyncer/worker` — no TypeScript errors.
- `POST /posts/:id/schedule { scheduled_at: "..." }` returns 202 with `scheduled_at` in response.
- `POST /posts/:id/schedule {}` returns 400.
- `POST /posts/:id/schedule { cron: "..." }` returns 400 (old body rejected).
- MCP `tools/list` returns 7 tools (not 8).
- Worker test confirms second fetch call is `PUT /api/posts/drafts/{id}?userId=...` with `{ scheduledDate }`, not `/publish`.

## Notes

- No new dependencies needed.
- `schedule_cron` is fully removed from `PostRecord`; any lingering references will be caught by TypeScript build.
- The `DELETE /posts/:id/schedule` endpoint is removed entirely. Return 404 naturally (no route registered).
- `PublishJobState.status` automatically includes `"scheduled"` via `Exclude<PostStatus, "draft" | "queued">` once `PostStatus` is updated.
