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
