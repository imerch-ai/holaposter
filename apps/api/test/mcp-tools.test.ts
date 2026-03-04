import { describe, expect, it } from "vitest";

import { NoopPublishQueue } from "../src/queue/publish-queue";
import { sharedPostStore } from "../src/store/post-store";
import {
  createPost,
  getMetricsOverview,
  getPostMetrics,
  getQueueStats,
  listPosts
} from "../src/mcp/tools";
import type { MetricsClient, MetricsOverviewResult, PostMetricsResult } from "../src/metrics/metrics-client";

describe("MCP tools", () => {
  const queue = new NoopPublishQueue();

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
});
