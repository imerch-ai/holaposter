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
