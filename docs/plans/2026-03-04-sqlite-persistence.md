# SQLite Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the in-memory PostStore and HTTP job-state callback with a shared SQLite database that both the API and Worker containers access directly via a mounted Docker volume.

**Architecture:** A single `postsyncer.db` SQLite file lives at `/data/postsyncer.db` (env var `SQLITE_DB_PATH`), mounted via a shared Docker volume into both `api` and `worker` containers. The `PostStore` interface gains proper async CRUD methods; `SqlitePostStore` implements them with WAL mode for concurrent reads. The Worker gets a `SqliteJobStateRepository` that writes directly to the same file — eliminating the fragile HTTP round-trip through `HttpJobStateRepository`.

**Tech Stack:** `better-sqlite3` (synchronous native SQLite bindings, Node.js CommonJS), Docker named volume, WAL journal mode.

---

## Task 1: Redesign the PostStore interface

**Files:**
- Modify: `apps/api/src/routes/posts.ts`

The current `PostStore` is a plain data object `{ byId: Map, list: [] }`. We need async CRUD methods so the interface works for both in-memory (tests) and SQLite (production).

**Step 1: Replace the interface in `posts.ts`**

Change lines 12–15 from:
```typescript
export interface PostStore {
  byId: Map<string, PostRecord>;
  list: PostRecord[];
}
```
To:
```typescript
export interface PostStore {
  create(record: PostRecord): Promise<void>;
  getById(id: string): Promise<PostRecord | undefined>;
  list(options?: { status?: string; limit?: number }): Promise<PostRecord[]>;
  update(id: string, changes: Partial<PostRecord>): Promise<PostRecord | undefined>;
}
```

**Step 2: Update `POST /posts` route in `posts.ts`**

```typescript
app.post("/posts", async (request, reply) => {
  const parseResult = createPostSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.code(400).send({ error: "content is required" });
  }
  const now = new Date().toISOString();
  const post: PostRecord = {
    id: randomUUID(),
    content: parseResult.data.content,
    status: "draft",
    created_at: now,
    updated_at: now
  };
  await store.create(post);
  return reply.code(201).send(post);
});
```

**Step 3: Update `GET /posts` route**

```typescript
app.get("/posts", async () => {
  return store.list();
});
```

**Step 4: Update `GET /posts/:id` route**

```typescript
app.get("/posts/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const postId = params.id;
  if (!postId) return reply.code(404).send({ error: "post not found" });
  const post = await store.getById(postId);
  if (!post) return reply.code(404).send({ error: "post not found" });
  return post;
});
```

**Step 5: Run existing tests to see what breaks**

```bash
npm test --workspace=@postsyncer/api
```
Expected: Failures in anything constructing `PostStore` as `{ byId: new Map(), list: [] }`.

**Step 6: Commit**

```bash
git add apps/api/src/routes/posts.ts
git commit -m "refactor: replace PostStore plain object with async CRUD interface"
```

---

## Task 2: Create InMemoryPostStore (for tests and server default)

**Files:**
- Modify: `apps/api/src/store/post-store.ts`

Replace the exported singleton with a class that implements the new interface.

**Step 1: Write the test**

Create `apps/api/src/store/post-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPostStore } from "./post-store";
import type { PostRecord } from "../domain/types";

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "test-id",
    content: "hello",
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("InMemoryPostStore", () => {
  let store: InMemoryPostStore;

  beforeEach(() => {
    store = new InMemoryPostStore();
  });

  it("creates and retrieves a post", async () => {
    const post = makePost();
    await store.create(post);
    const found = await store.getById("test-id");
    expect(found).toEqual(post);
  });

  it("returns undefined for unknown id", async () => {
    expect(await store.getById("nope")).toBeUndefined();
  });

  it("lists all posts", async () => {
    await store.create(makePost({ id: "a" }));
    await store.create(makePost({ id: "b" }));
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("filters by status", async () => {
    await store.create(makePost({ id: "a", status: "draft" }));
    await store.create(makePost({ id: "b", status: "published" }));
    const drafts = await store.list({ status: "draft" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("a");
  });

  it("applies limit", async () => {
    await store.create(makePost({ id: "a" }));
    await store.create(makePost({ id: "b" }));
    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("updates a post", async () => {
    await store.create(makePost());
    const updated = await store.update("test-id", { status: "queued" });
    expect(updated?.status).toBe("queued");
    expect((await store.getById("test-id"))?.status).toBe("queued");
  });

  it("returns undefined when updating missing post", async () => {
    expect(await store.update("nope", { status: "queued" })).toBeUndefined();
  });
});
```

**Step 2: Run test to confirm it fails**

```bash
npm test --workspace=@postsyncer/api -- post-store
```
Expected: FAIL — `InMemoryPostStore` not exported from `post-store.ts`.

**Step 3: Implement `InMemoryPostStore`**

Replace the contents of `apps/api/src/store/post-store.ts`:
```typescript
import type { PostRecord } from "../domain/types";
import type { PostStore } from "../routes/posts";

export class InMemoryPostStore implements PostStore {
  private readonly map = new Map<string, PostRecord>();

  async create(record: PostRecord): Promise<void> {
    this.map.set(record.id, { ...record });
  }

  async getById(id: string): Promise<PostRecord | undefined> {
    return this.map.get(id);
  }

  async list(options?: { status?: string; limit?: number }): Promise<PostRecord[]> {
    let result = Array.from(this.map.values());
    if (options?.status) result = result.filter((p) => p.status === options.status);
    if (options?.limit) result = result.slice(0, options.limit);
    return result;
  }

  async update(id: string, changes: Partial<PostRecord>): Promise<PostRecord | undefined> {
    const post = this.map.get(id);
    if (!post) return undefined;
    Object.assign(post, changes);
    return post;
  }
}
```

**Step 4: Run test to confirm it passes**

```bash
npm test --workspace=@postsyncer/api -- post-store
```
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/store/post-store.ts apps/api/src/store/post-store.test.ts
git commit -m "feat: add InMemoryPostStore implementing async PostStore interface"
```

---

## Task 3: Update `mcp/tools.ts` to use async PostStore

**Files:**
- Modify: `apps/api/src/mcp/tools.ts`

All `store.byId.get()`, `store.byId.set()`, `store.list.push()`, `store.list` direct accesses become async method calls.

**Step 1: Rewrite `tools.ts`**

```typescript
import { randomUUID } from "node:crypto";

import type { PostRecord } from "../domain/types";
import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "../routes/posts";

export async function createPost(
  { content, scheduled_at }: { content: string; scheduled_at?: string },
  store: PostStore
): Promise<PostRecord> {
  const now = new Date().toISOString();
  const post: PostRecord = {
    id: randomUUID(),
    content,
    status: "draft",
    created_at: now,
    updated_at: now,
    ...(scheduled_at ? { scheduled_at } : {})
  };
  await store.create(post);
  return post;
}

export async function updatePost(
  { post_id, content, scheduled_at }: { post_id: string; content?: string; scheduled_at?: string },
  store: PostStore
): Promise<PostRecord | null> {
  const changes: Partial<PostRecord> = { updated_at: new Date().toISOString() };
  if (content !== undefined) changes.content = content;
  if (scheduled_at !== undefined) changes.scheduled_at = scheduled_at;
  return (await store.update(post_id, changes)) ?? null;
}

export async function listPosts(
  { status, limit }: { status?: string; limit?: number },
  store: PostStore
): Promise<PostRecord[]> {
  return store.list({ status, limit });
}

export async function getPost(
  { post_id }: { post_id: string },
  store: PostStore
): Promise<PostRecord | null> {
  return (await store.getById(post_id)) ?? null;
}

export async function queuePublish(
  { post_id }: { post_id: string },
  store: PostStore,
  queue: PublishQueue
): Promise<{ job_id: string } | null> {
  const post = await store.getById(post_id);
  if (!post) return null;
  const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
  await store.update(post_id, { status: "queued", updated_at: new Date().toISOString() });
  await queue.enqueue({
    post_id,
    content: post.content,
    holaboss_user_id,
    ...(post.scheduled_at ? { scheduled_at: post.scheduled_at } : {})
  });
  return { job_id: `job:${post_id}` };
}

export async function cancelPublish(
  { post_id }: { post_id: string },
  store: PostStore
): Promise<{ cancelled: boolean; error?: string } | null> {
  const post = await store.getById(post_id);
  if (!post) return null;

  if (post.status !== "scheduled" || !post.external_post_id) {
    return { cancelled: false, error: "post is not in scheduled state" };
  }

  const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
  const workspaceApiUrl = (process.env.WORKSPACE_API_URL ?? "http://localhost:3033").replace(/\/+$/, "");
  const integrationToken = process.env.PLATFORM_INTEGRATION_TOKEN ?? "";

  const res = await fetch(
    `${workspaceApiUrl}/api/posts/drafts/${post.external_post_id}?userId=${encodeURIComponent(holaboss_user_id)}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(integrationToken ? { Authorization: `Bearer ${integrationToken}` } : {})
      }
    }
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    return { cancelled: false, error: `cancel_failed:${res.status}:${body}` };
  }

  await store.update(post_id, {
    status: "draft",
    external_post_id: undefined,
    scheduled_at: undefined,
    updated_at: new Date().toISOString()
  });

  return { cancelled: true };
}

export async function getPublishStatus(
  { post_id }: { post_id: string },
  store: PostStore
): Promise<{ status: string; error?: string; published_at?: string } | null> {
  const post = await store.getById(post_id);
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

**Step 2: Update `routes/publish.ts`** to use async store methods:

```typescript
// In POST /posts/:id/publish:
const post = await store.getById(postId);
if (!post) return reply.code(404).send({ error: "post not found" });
await store.update(postId, { status: "queued", updated_at: new Date().toISOString() });
await queue.enqueue({ post_id: post.id, content: post.content, holaboss_user_id });
return reply.code(202).send({ post_id: post.id, status: "queued" });

// In POST /posts/:id/schedule:
const post = await store.getById(postId);
if (!post) return reply.code(404).send({ error: "post not found" });
const scheduledAt = parsedBody.data.scheduled_at;
await store.update(postId, { status: "queued", scheduled_at: scheduledAt, updated_at: new Date().toISOString() });
await queue.enqueue({ post_id: post.id, content: post.content, holaboss_user_id, scheduled_at: scheduledAt });
return reply.code(202).send({ post_id: post.id, status: "queued", scheduled_at: scheduledAt });
```

**Step 3: Update `routes/internal-job-states.ts`** to use async store:

```typescript
const post = await store.getById(parsed.data.post_id);
if (!post) return reply.code(404).send({ error: "post not found" });
await store.update(parsed.data.post_id, {
  status: parsed.data.status as PostStatus,
  updated_at: new Date().toISOString(),
  error_code: parsed.data.error_code,
  error_message: parsed.data.error_message,
  external_post_id: parsed.data.external_post_id
});
return reply.code(200).send({ ok: true });
```

**Step 4: Run tests**

```bash
npm test --workspace=@postsyncer/api
```
Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/api/src/mcp/tools.ts apps/api/src/routes/publish.ts apps/api/src/routes/internal-job-states.ts
git commit -m "refactor: update all route/tool handlers to use async PostStore interface"
```

---

## Task 4: Update API `server.ts` default store

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`

**Step 1: Update `server.ts` default store**

Replace the fallback `{ byId: new Map(), list: [] }` with `InMemoryPostStore`:

```typescript
import { InMemoryPostStore } from "./store/post-store";

// in buildServer:
const postStore: PostStore = options.store ?? new InMemoryPostStore();
```

**Step 2: Update `index.ts` to use `SqlitePostStore` (placeholder for now)**

```typescript
// Replace:
import { sharedPostStore } from "./store/post-store";
// With:
import { InMemoryPostStore } from "./store/post-store";
const store = new InMemoryPostStore(); // will replace with SqlitePostStore in Task 6
```

**Step 3: Run tests**

```bash
npm test --workspace=@postsyncer/api
```
Expected: PASS.

**Step 4: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/index.ts
git commit -m "refactor: wire InMemoryPostStore as default in server and index"
```

---

## Task 5: Implement SqlitePostStore

**Files:**
- Modify: `apps/api/package.json` (add dependency)
- Create: `apps/api/src/store/sqlite-post-store.ts`
- Create: `apps/api/src/store/sqlite-post-store.test.ts`

**Step 1: Add `better-sqlite3`**

```bash
npm install better-sqlite3 --workspace=@postsyncer/api
npm install --save-dev @types/better-sqlite3 --workspace=@postsyncer/api
```

**Step 2: Write the test (uses `:memory:` so no file is created)**

Create `apps/api/src/store/sqlite-post-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlitePostStore } from "./sqlite-post-store";
import type { PostRecord } from "../domain/types";

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "test-id",
    content: "hello",
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("SqlitePostStore", () => {
  let store: SqlitePostStore;

  beforeEach(() => {
    store = new SqlitePostStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("creates and retrieves a post", async () => {
    const post = makePost();
    await store.create(post);
    const found = await store.getById("test-id");
    expect(found?.id).toBe("test-id");
    expect(found?.content).toBe("hello");
    expect(found?.status).toBe("draft");
  });

  it("returns undefined for unknown id", async () => {
    expect(await store.getById("nope")).toBeUndefined();
  });

  it("lists all posts", async () => {
    await store.create(makePost({ id: "a" }));
    await store.create(makePost({ id: "b" }));
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("filters by status", async () => {
    await store.create(makePost({ id: "a", status: "draft" }));
    await store.create(makePost({ id: "b", status: "published" }));
    const drafts = await store.list({ status: "draft" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("a");
  });

  it("applies limit", async () => {
    await store.create(makePost({ id: "a" }));
    await store.create(makePost({ id: "b" }));
    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("updates a post", async () => {
    await store.create(makePost());
    const updated = await store.update("test-id", { status: "queued" });
    expect(updated?.status).toBe("queued");
    const fetched = await store.getById("test-id");
    expect(fetched?.status).toBe("queued");
  });

  it("returns undefined when updating missing post", async () => {
    expect(await store.update("nope", { status: "queued" })).toBeUndefined();
  });

  it("stores and retrieves optional fields", async () => {
    const post = makePost({ scheduled_at: "2026-06-01T12:00:00.000Z", external_post_id: "ext-123" });
    await store.create(post);
    const found = await store.getById("test-id");
    expect(found?.scheduled_at).toBe("2026-06-01T12:00:00.000Z");
    expect(found?.external_post_id).toBe("ext-123");
  });

  it("clears optional fields on update", async () => {
    await store.create(makePost({ scheduled_at: "2026-06-01T12:00:00.000Z" }));
    await store.update("test-id", { scheduled_at: undefined });
    const found = await store.getById("test-id");
    expect(found?.scheduled_at).toBeUndefined();
  });
});
```

**Step 3: Run test to confirm it fails**

```bash
npm test --workspace=@postsyncer/api -- sqlite-post-store
```
Expected: FAIL — `SqlitePostStore` not found.

**Step 4: Implement `SqlitePostStore`**

Create `apps/api/src/store/sqlite-post-store.ts`:
```typescript
import Database from "better-sqlite3";
import type { PostRecord } from "../domain/types";
import type { PostStore } from "../routes/posts";

interface PostRow {
  id: string;
  content: string;
  status: string;
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
  external_post_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

function rowToRecord(row: PostRow): PostRecord {
  return {
    id: row.id,
    content: row.content,
    status: row.status as PostRecord["status"],
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.scheduled_at != null ? { scheduled_at: row.scheduled_at } : {}),
    ...(row.external_post_id != null ? { external_post_id: row.external_post_id } : {}),
    ...(row.error_code != null ? { error_code: row.error_code } : {}),
    ...(row.error_message != null ? { error_message: row.error_message } : {})
  };
}

export class SqlitePostStore implements PostStore {
  private readonly db: Database.Database;

  constructor(dbPath = process.env.SQLITE_DB_PATH ?? "/data/postsyncer.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        scheduled_at TEXT,
        external_post_id TEXT,
        error_code TEXT,
        error_message TEXT
      )
    `);
  }

  async create(record: PostRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO posts (id, content, status, created_at, updated_at, scheduled_at, external_post_id, error_code, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.content,
        record.status,
        record.created_at,
        record.updated_at,
        record.scheduled_at ?? null,
        record.external_post_id ?? null,
        record.error_code ?? null,
        record.error_message ?? null
      );
  }

  async getById(id: string): Promise<PostRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  async list(options?: { status?: string; limit?: number }): Promise<PostRecord[]> {
    let sql = "SELECT * FROM posts";
    const params: (string | number)[] = [];
    if (options?.status) {
      sql += " WHERE status = ?";
      params.push(options.status);
    }
    sql += " ORDER BY updated_at DESC";
    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as PostRow[];
    return rows.map(rowToRecord);
  }

  async update(id: string, changes: Partial<PostRecord>): Promise<PostRecord | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;

    const merged: PostRecord = { ...existing };
    for (const key of Object.keys(changes) as (keyof PostRecord)[]) {
      if (key in changes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = (changes as any)[key];
      }
    }

    this.db
      .prepare(
        `UPDATE posts SET content = ?, status = ?, updated_at = ?, scheduled_at = ?, external_post_id = ?, error_code = ?, error_message = ?
         WHERE id = ?`
      )
      .run(
        merged.content,
        merged.status,
        merged.updated_at,
        merged.scheduled_at ?? null,
        merged.external_post_id ?? null,
        merged.error_code ?? null,
        merged.error_message ?? null,
        id
      );

    return merged;
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 5: Run test to confirm it passes**

```bash
npm test --workspace=@postsyncer/api -- sqlite-post-store
```
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/api/src/store/sqlite-post-store.ts apps/api/src/store/sqlite-post-store.test.ts apps/api/package.json package-lock.json
git commit -m "feat: implement SqlitePostStore with WAL mode and full CRUD"
```

---

## Task 6: Wire SqlitePostStore into the API

**Files:**
- Modify: `apps/api/src/index.ts`

**Step 1: Update `index.ts`**

```typescript
import { SqlitePostStore } from "./store/sqlite-post-store";

async function start() {
  const port = Number(process.env.PORT ?? "8080");
  const host = process.env.HOST ?? "0.0.0.0";
  const queue = new BullMqPublishQueue();
  const store = new SqlitePostStore();  // reads SQLITE_DB_PATH from env
  const app = buildServer({ queue, store });
  // ...
  const mcpServer = await startMcpServer({ port: mcpPort, store, queue });
  // ...
  const shutdown = async (signal: string) => {
    mcpServer.close();
    await app.close();
    await queue.close();
    store.close();  // close SQLite db
    process.exit(0);
  };
}
```

**Step 2: Run all API tests**

```bash
npm test --workspace=@postsyncer/api
```
Expected: PASS (tests use InMemoryPostStore internally).

**Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: wire SqlitePostStore as the API's persistent post store"
```

---

## Task 7: Implement SqliteJobStateRepository in Worker

**Files:**
- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/repository/sqlite-job-state-repo.ts`
- Create: `apps/worker/src/repository/sqlite-job-state-repo.test.ts`

**Step 1: Add `better-sqlite3` to worker**

```bash
npm install better-sqlite3 --workspace=@postsyncer/worker
npm install --save-dev @types/better-sqlite3 --workspace=@postsyncer/worker
```

**Step 2: Write the test**

Create `apps/worker/src/repository/sqlite-job-state-repo.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteJobStateRepository } from "./sqlite-job-state-repo";
import type { PublishJobState } from "./job-state-repo";

describe("SqliteJobStateRepository", () => {
  let repo: SqliteJobStateRepository;

  beforeEach(async () => {
    // Seed a post so UPDATE has a row to touch
    repo = new SqliteJobStateRepository(":memory:");
    await repo.seedPost("post-1");
  });

  afterEach(() => {
    repo.close();
  });

  it("saves job state to the post row", async () => {
    const state: PublishJobState = {
      post_id: "post-1",
      holaboss_user_id: "user-1",
      status: "published",
      external_post_id: "tweet-123"
    };
    await repo.save(state);
    const row = repo.getPostRow("post-1");
    expect(row?.status).toBe("published");
    expect(row?.external_post_id).toBe("tweet-123");
  });

  it("skips silently when post_id not found", async () => {
    await expect(
      repo.save({ post_id: "ghost", holaboss_user_id: "u", status: "published" })
    ).resolves.not.toThrow();
  });
});
```

> **Note on `seedPost` and `getPostRow`:** These are test-only helpers. The real worker repo only needs `save()`. We expose them as `public` on the class for testability (no mock needed).

**Step 3: Run test to confirm it fails**

```bash
npm test --workspace=@postsyncer/worker -- sqlite-job-state-repo
```
Expected: FAIL.

**Step 4: Implement `SqliteJobStateRepository`**

Create `apps/worker/src/repository/sqlite-job-state-repo.ts`:
```typescript
import Database from "better-sqlite3";
import type { JobStateRepository, PublishJobState } from "./job-state-repo";

export class SqliteJobStateRepository implements JobStateRepository {
  private readonly db: Database.Database;

  constructor(dbPath = process.env.SQLITE_DB_PATH ?? "/data/postsyncer.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
  }

  async save(state: PublishJobState): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE posts SET status = ?, updated_at = ?, external_post_id = ?, error_code = ?, error_message = ?
         WHERE id = ?`
      )
      .run(
        state.status,
        new Date().toISOString(),
        state.external_post_id ?? null,
        state.error_code ?? null,
        state.error_message ?? null,
        state.post_id
      );

    if (result.changes === 0) {
      console.warn("job_state_sync_skipped:post_not_found", { post_id: state.post_id });
    }
  }

  // Test helpers — safe to expose (read-only)
  seedPost(postId: string): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        scheduled_at TEXT, external_post_id TEXT, error_code TEXT, error_message TEXT
      )
    `);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO posts (id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(postId, "test", "queued", new Date().toISOString(), new Date().toISOString());
  }

  getPostRow(postId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as
      | Record<string, unknown>
      | undefined;
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 5: Run test to confirm it passes**

```bash
npm test --workspace=@postsyncer/worker -- sqlite-job-state-repo
```
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/repository/sqlite-job-state-repo.ts apps/worker/src/repository/sqlite-job-state-repo.test.ts apps/worker/package.json package-lock.json
git commit -m "feat: implement SqliteJobStateRepository for direct DB state writes"
```

---

## Task 8: Wire SqliteJobStateRepository into Worker, remove HttpJobStateRepository

**Files:**
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/repository/job-state-repo.ts` (remove `HttpJobStateRepository`)

**Step 1: Update `queue.ts`**

Replace `HttpJobStateRepository` with `SqliteJobStateRepository`:
```typescript
import { SqliteJobStateRepository } from "./repository/sqlite-job-state-repo";

export function createPublishWorker() {
  const xPublisher = new PlatformXPublisher();
  const sqlite = new SqliteJobStateRepository();
  const jobRepository = new CompositeJobStateRepository([sqlite, new ConsoleJobStateRepository()]);
  // rest unchanged...
}
```

Also add shutdown of the SQLite repo. Update `apps/worker/src/index.ts`:
```typescript
const worker = createPublishWorker();
// ...
const shutdown = async (signal: string) => {
  await worker.close();
  // SqliteJobStateRepository is closed when worker process ends; DB file is safe
  process.exit(0);
};
```

**Step 2: Remove `HttpJobStateRepository` from `job-state-repo.ts`**

Delete the `HttpJobStateRepository` class and constructor. Keep `JobStateRepository` interface, `PublishJobState` type, `ConsoleJobStateRepository`, and `CompositeJobStateRepository`.

**Step 3: Remove `/internal/job-states` route from API**

In `apps/api/src/server.ts`, remove:
```typescript
import { registerInternalJobStateRoutes } from "./routes/internal-job-states";
// and
void registerInternalJobStateRoutes(app, postStore);
```

Delete `apps/api/src/routes/internal-job-states.ts`.

**Step 4: Run all tests**

```bash
npm test --workspace=@postsyncer/api
npm test --workspace=@postsyncer/worker
```
Expected: All pass.

**Step 5: Commit**

```bash
git add apps/worker/src/queue.ts apps/worker/src/repository/job-state-repo.ts apps/worker/src/index.ts
git add apps/api/src/server.ts
git rm apps/api/src/routes/internal-job-states.ts
git commit -m "feat: replace HttpJobStateRepository with SqliteJobStateRepository, remove /internal/job-states route"
```

---

## Task 9: Update docker-compose.yml — remove Postgres, add shared SQLite volume

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Remove `postgres` service entirely**

Delete lines 10–26 (the entire `postgres:` block).

**Step 2: Remove postgres `depends_on` from `api` service**

Delete lines 49–50 (`postgres: condition: service_healthy`).

**Step 3: Add `SQLITE_DB_PATH` to `api` and `worker` environments**

```yaml
# api service environment:
SQLITE_DB_PATH: /data/postsyncer.db

# worker service environment:
SQLITE_DB_PATH: /data/postsyncer.db
```

**Step 4: Add shared volume mounts to `api` and `worker`**

```yaml
# api service:
volumes:
  - postsyncer-data:/data

# worker service:
volumes:
  - postsyncer-data:/data
```

**Step 5: Remove unused env vars from `api` service**

Remove `INTERNAL_API_TOKEN` from api environment (no longer needed — it was for the HTTP callback).

**Step 6: Remove unused env vars from `worker` service**

Remove `API_INTERNAL_URL` and `INTERNAL_API_TOKEN` from worker environment.

**Step 7: Replace the `postsyncer-postgres` volume with `postsyncer-data` in the volumes section**

```yaml
volumes:
  postsyncer-data:
```

**Step 8: Verify docker-compose is valid**

```bash
docker compose config
```
Expected: Valid config printed with no errors.

**Step 9: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: replace Postgres with SQLite volume, remove HTTP job-state callback env vars"
```

---

## Task 10: Update app.runtime.yaml and env_contract

**Files:**
- Modify: `app.runtime.yaml`

**Step 1: Remove `postgres` from services**

Delete lines:
```yaml
  postgres:
    image: "postgres:16-alpine"
```

**Step 2: Remove obsolete env vars from `env_contract`**

Remove `API_INTERNAL_URL` and `INTERNAL_API_TOKEN` from the `env_contract` list. These were only needed for the HTTP job-state callback.

**Step 3: Commit**

```bash
git add app.runtime.yaml
git commit -m "chore: remove postgres service and dead env vars from runtime contract"
```

---

## Task 11: Smoke test end-to-end

**Step 1: Build and start the stack**

```bash
docker compose build
docker compose up
```

**Step 2: Create a draft via the API**

```bash
curl -s -X POST http://localhost:8080/posts \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello SQLite"}' | jq .
```
Expected: `{ "id": "...", "status": "draft", ... }`

**Step 3: List posts — survive a restart**

```bash
docker compose restart api
curl -s http://localhost:8080/posts | jq .
```
Expected: The post created in Step 2 is still there (proves persistence).

**Step 4: Verify MCP tool works**

```bash
curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_posts","arguments":{}}}' | jq .
```
Expected: JSON-RPC response with the post in the list.

**Step 5: Commit if any last fixes needed, otherwise done**

```bash
git add .
git commit -m "chore: post smoke-test cleanup"
```

---

## Summary of Changes

| File | Action |
|------|--------|
| `apps/api/src/routes/posts.ts` | Rewrite `PostStore` interface to async CRUD |
| `apps/api/src/store/post-store.ts` | Replace singleton with `InMemoryPostStore` class |
| `apps/api/src/store/sqlite-post-store.ts` | **New** — SQLite-backed `PostStore` |
| `apps/api/src/store/sqlite-post-store.test.ts` | **New** — Tests using `:memory:` |
| `apps/api/src/store/post-store.test.ts` | **New** — Tests for `InMemoryPostStore` |
| `apps/api/src/mcp/tools.ts` | Use async `store.*()` methods |
| `apps/api/src/routes/publish.ts` | Use async `store.*()` methods |
| `apps/api/src/routes/internal-job-states.ts` | **Deleted** |
| `apps/api/src/server.ts` | Remove `registerInternalJobStateRoutes`, default `InMemoryPostStore` |
| `apps/api/src/index.ts` | Wire `SqlitePostStore`, close on shutdown |
| `apps/api/package.json` | Add `better-sqlite3` |
| `apps/worker/src/repository/sqlite-job-state-repo.ts` | **New** — Direct SQLite writes |
| `apps/worker/src/repository/sqlite-job-state-repo.test.ts` | **New** |
| `apps/worker/src/repository/job-state-repo.ts` | Remove `HttpJobStateRepository` |
| `apps/worker/src/queue.ts` | Use `SqliteJobStateRepository` |
| `apps/worker/package.json` | Add `better-sqlite3` |
| `docker-compose.yml` | Remove Postgres, add `postsyncer-data` volume |
| `app.runtime.yaml` | Remove Postgres service, remove dead env vars |
