# Post Metrics MCP Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose two new MCP tools (`get_post_metrics` and `get_metrics_overview`) that fetch X/Twitter post statistics from the workspace API.

**Architecture:** Both tools call the workspace API's Post Metrics endpoints (`/api/post-metrics/...`) using the existing `WORKSPACE_API_URL` + `PLATFORM_INTEGRATION_TOKEN` auth pattern. A shared `MetricsClient` encapsulates the HTTP calls, keeping tool functions thin. Tests use a stub client — no real HTTP in tests.

**Tech Stack:** TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), Zod, Vitest

---

### Task 1: Create MetricsClient interface and workspace implementation

**Files:**
- Create: `apps/api/src/metrics/metrics-client.ts`

**Step 1: Create the MetricsClient interface and WorkspaceMetricsClient class**

```typescript
export interface PostMetricsResult {
  post: {
    id: string;
    content: string;
    publishDate: string;
    platform: string;
  };
  metrics: {
    likeCount: number;
    commentCount: number;
    shareCount: number;
    repostCount: number;
    quoteCount: number;
    bookmarkCount: number;
    viewCount: string;
    platformMetrics: {
      impressions: number;
      engagementRate: number;
      reach: number;
    };
  };
  engagementRate: number;
  totalInteractions: number;
  performanceScore: number;
}

export interface MetricsOverviewResult {
  stats: {
    totalPosts: number;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
    totalInteractions: number;
    avgEngagementRate: number;
    growthRate: number;
  };
  topPosts: Array<{
    postId: string;
    content: string;
    platform: string;
    totalInteractions: number;
    engagementRate: number;
    publishDate: string;
  }>;
  platformBreakdown: Record<string, { posts: number; avgEngagement: number }>;
  bestPostingHours: number[];
}

export interface MetricsClient {
  getPostMetrics(externalPostId: string): Promise<PostMetricsResult>;
  getOverview(timeRange?: string): Promise<MetricsOverviewResult>;
}

export class WorkspaceMetricsClient implements MetricsClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userId: string;

  constructor() {
    this.baseUrl = (process.env.WORKSPACE_API_URL ?? "http://localhost:3033").replace(/\/+$/, "");
    this.token = process.env.PLATFORM_INTEGRATION_TOKEN ?? "";
    this.userId = process.env.HOLABOSS_USER_ID ?? "";
  }

  async getPostMetrics(externalPostId: string): Promise<PostMetricsResult> {
    const url = `${this.baseUrl}/api/post-metrics/x/posts/${encodeURIComponent(externalPostId)}?userId=${encodeURIComponent(this.userId)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`metrics_fetch_failed:${res.status}:${body}`);
    }
    return (await res.json()) as PostMetricsResult;
  }

  async getOverview(timeRange = "7d"): Promise<MetricsOverviewResult> {
    const url = `${this.baseUrl}/api/post-metrics/overview?userId=${encodeURIComponent(this.userId)}&platform=x&timeRange=${encodeURIComponent(timeRange)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`metrics_overview_failed:${res.status}:${body}`);
    }
    return (await res.json()) as MetricsOverviewResult;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/metrics/metrics-client.ts
git commit -m "feat: add MetricsClient interface and workspace implementation"
```

---

### Task 2: Write failing tests for the two new tool functions

**Files:**
- Modify: `apps/api/test/mcp-tools.test.ts`

**Step 1: Write the failing tests**

Add these tests to the existing `describe("MCP tools", ...)` block:

```typescript
import {
  createPost,
  getMetricsOverview,
  getPostMetrics,
  getQueueStats,
  listPosts
} from "../src/mcp/tools";
import type { MetricsClient, MetricsOverviewResult, PostMetricsResult } from "../src/metrics/metrics-client";

// Add this stub class inside the describe block:
class StubMetricsClient implements MetricsClient {
  lastPostId = "";
  lastTimeRange = "";

  async getPostMetrics(externalPostId: string): Promise<PostMetricsResult> {
    this.lastPostId = externalPostId;
    return {
      post: { id: externalPostId, content: "test", publishDate: "2024-01-01T00:00:00Z", platform: "x" },
      metrics: {
        likeCount: 10, commentCount: 2, shareCount: 3, repostCount: 1,
        quoteCount: 0, bookmarkCount: 5, viewCount: "100",
        platformMetrics: { impressions: 100, engagementRate: 0.05, reach: 80 }
      },
      engagementRate: 0.05,
      totalInteractions: 21,
      performanceScore: 72
    };
  }

  async getOverview(timeRange?: string): Promise<MetricsOverviewResult> {
    this.lastTimeRange = timeRange ?? "7d";
    return {
      stats: {
        totalPosts: 10, totalLikes: 100, totalComments: 20,
        totalShares: 15, totalInteractions: 135, avgEngagementRate: 0.04, growthRate: 0.1
      },
      topPosts: [],
      platformBreakdown: { x: { posts: 10, avgEngagement: 0.04 } },
      bestPostingHours: [14, 16]
    };
  }
}

// Tests:
it("get_post_metrics returns metrics for a published post", async () => {
  const metricsClient = new StubMetricsClient();
  const post = await createPost({ content: "metrics test" }, sharedPostStore);
  post.status = "published";
  post.external_post_id = "ext_123";
  const result = await getPostMetrics({ post_id: post.id }, sharedPostStore, metricsClient);
  expect(result).not.toBeNull();
  expect(metricsClient.lastPostId).toBe("ext_123");
  expect(result!.totalInteractions).toBe(21);
});

it("get_post_metrics returns null for unknown post", async () => {
  const metricsClient = new StubMetricsClient();
  const result = await getPostMetrics({ post_id: "nonexistent" }, sharedPostStore, metricsClient);
  expect(result).toBeNull();
});

it("get_post_metrics returns error for unpublished post", async () => {
  const metricsClient = new StubMetricsClient();
  const post = await createPost({ content: "draft post" }, sharedPostStore);
  const result = await getPostMetrics({ post_id: post.id }, sharedPostStore, metricsClient);
  expect(result).toEqual({ error: "post has no external_post_id — not yet published" });
});

it("get_metrics_overview returns overview stats", async () => {
  const metricsClient = new StubMetricsClient();
  const result = await getMetricsOverview({ time_range: "30d" }, metricsClient);
  expect(metricsClient.lastTimeRange).toBe("30d");
  expect(result.stats.totalPosts).toBe(10);
});

it("get_metrics_overview defaults to 7d", async () => {
  const metricsClient = new StubMetricsClient();
  const result = await getMetricsOverview({}, metricsClient);
  expect(metricsClient.lastTimeRange).toBe("7d");
  expect(result.stats).toBeDefined();
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run test/mcp-tools.test.ts
```

Expected: FAIL — `getPostMetrics` and `getMetricsOverview` are not exported from `tools.ts`.

**Step 3: Commit the failing tests**

```bash
git add apps/api/test/mcp-tools.test.ts
git commit -m "test: add failing tests for get_post_metrics and get_metrics_overview"
```

---

### Task 3: Implement the two tool functions

**Files:**
- Modify: `apps/api/src/mcp/tools.ts`

**Step 1: Add the two new functions to tools.ts**

Append after the existing `getQueueStats` function:

```typescript
import type { MetricsClient, MetricsOverviewResult, PostMetricsResult } from "../metrics/metrics-client";

export async function getPostMetrics(
  { post_id }: { post_id: string },
  store: PostStore,
  metricsClient: MetricsClient
): Promise<PostMetricsResult | { error: string } | null> {
  const post = store.byId.get(post_id);
  if (!post) return null;
  if (!post.external_post_id) {
    return { error: "post has no external_post_id — not yet published" };
  }
  return metricsClient.getPostMetrics(post.external_post_id);
}

export async function getMetricsOverview(
  { time_range }: { time_range?: string },
  metricsClient: MetricsClient
): Promise<MetricsOverviewResult> {
  return metricsClient.getOverview(time_range ?? "7d");
}
```

**Step 2: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run test/mcp-tools.test.ts
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add apps/api/src/mcp/tools.ts
git commit -m "feat: implement getPostMetrics and getMetricsOverview tool functions"
```

---

### Task 4: Register the two new MCP tools in the server

**Files:**
- Modify: `apps/api/src/mcp/server.ts`

**Step 1: Update buildMcpServer to accept MetricsClient and register tools**

The function signature changes to accept a `MetricsClient`. Add two new `mcp.tool(...)` registrations after the existing `get_queue_stats` tool:

```typescript
import type { MetricsClient } from "../metrics/metrics-client";

// Update function signature:
export function buildMcpServer(store: PostStore, queue: PublishQueue, metricsClient: MetricsClient): McpServer {

  // ... existing tools stay unchanged ...

  // Add after get_queue_stats:
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
```

**Step 2: Update startMcpServer to accept and forward MetricsClient**

```typescript
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
  const mcp = buildMcpServer(store, queue, metricsClient);
  // ... rest stays the same ...
}
```

**Step 3: Commit**

```bash
git add apps/api/src/mcp/server.ts
git commit -m "feat: register get_post_metrics and get_metrics_overview MCP tools"
```

---

### Task 5: Wire MetricsClient into the app entrypoint

**Files:**
- Modify: `apps/api/src/index.ts`

**Step 1: Import and instantiate WorkspaceMetricsClient where the MCP server starts**

Find where `startMcpServer` or `buildMcpServer` is called and add:

```typescript
import { WorkspaceMetricsClient } from "./metrics/metrics-client";

const metricsClient = new WorkspaceMetricsClient();
```

Pass `metricsClient` to `startMcpServer(...)` or `buildMcpServer(...)`.

**Step 2: Run the full test suite**

```bash
cd apps/api && npx vitest run
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: wire WorkspaceMetricsClient into app entrypoint"
```

---

### Task 6: Update MCP server test to pass MetricsClient

**Files:**
- Modify: `apps/api/test/mcp-server.test.ts`

**Step 1: Check if the MCP server test calls `buildMcpServer` or `startMcpServer` and update to pass a stub MetricsClient**

Add a minimal stub (or reuse the one from Task 2) and pass it as the third argument.

**Step 2: Run all tests**

```bash
cd apps/api && npx vitest run
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add apps/api/test/mcp-server.test.ts
git commit -m "test: update MCP server test with MetricsClient stub"
```

---

### Summary

After all tasks, the MCP server exposes **10 tools** (8 existing + 2 new):

| Tool | Workspace API Endpoint | Input |
|------|----------------------|-------|
| `get_post_metrics` | `GET /api/post-metrics/x/posts/{id}` | `post_id` (internal) |
| `get_metrics_overview` | `GET /api/post-metrics/overview` | `time_range?` (7d/30d/90d) |

No new env vars needed — reuses `WORKSPACE_API_URL`, `PLATFORM_INTEGRATION_TOKEN`, `HOLABOSS_USER_ID`.
