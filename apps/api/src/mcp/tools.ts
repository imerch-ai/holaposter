import { randomUUID } from "node:crypto";

import type { PostRecord } from "../domain/types";
import type { MetricsClient, MetricsOverviewResult, PostMetricsResult } from "../metrics/metrics-client";
import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "../routes/posts";

export async function createPost(
  { content, scheduled_at, provider = "twitter-xdnq" }: { content: string; scheduled_at?: string; provider?: string },
  store: PostStore
): Promise<PostRecord> {
  const workspaceApiUrl = (process.env.WORKSPACE_API_URL ?? "").replace(/\/+$/, "");
  if (!workspaceApiUrl) throw new Error("WORKSPACE_API_URL is not configured");

  const integrationToken = process.env.PLATFORM_INTEGRATION_TOKEN ?? "";
  const integrationId = process.env.INTEGRATION_ID;

  const res = await fetch(`${workspaceApiUrl}/api/posts/drafts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(integrationToken ? { Authorization: `Bearer ${integrationToken}` } : {})
    },
    body: JSON.stringify({
      provider,
      content,
      ...(scheduled_at ? { scheduledDate: scheduled_at } : {}),
      ...(integrationId ? { integrationId } : {})
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create_draft_failed:${res.status}:${text}`);
  }

  const draft = (await res.json()) as { id: string };
  const now = new Date().toISOString();
  const post: PostRecord = {
    id: randomUUID(),
    content,
    status: "draft",
    created_at: now,
    updated_at: now,
    external_post_id: draft.id,
    ...(scheduled_at ? { scheduled_at } : {})
  };
  store.byId.set(post.id, post);
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
  let result = Array.from(store.byId.values());
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
  const post = store.byId.get(post_id);
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

  post.status = "draft";
  post.external_post_id = undefined;
  post.scheduled_at = undefined;
  post.updated_at = new Date().toISOString();

  return { cancelled: true };
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
