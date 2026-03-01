export type PostStatus = "draft" | "queued" | "publishing" | "published" | "failed";

export interface PostRecord {
  id: string;
  content: string;
  status: PostStatus;
  created_at: string;
  updated_at: string;
}

export interface PublishQueuePayload {
  post_id: string;
  content: string;
  holaboss_user_id: string;
}
