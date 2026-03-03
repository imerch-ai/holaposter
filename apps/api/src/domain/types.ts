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
