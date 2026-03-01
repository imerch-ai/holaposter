export type PublishJobStatus = "queued" | "publishing" | "published" | "failed";

export interface PublishJobState {
  post_id: string;
  holaboss_user_id: string;
  status: PublishJobStatus;
  error_code?: string;
  error_message?: string;
  external_post_id?: string;
}

export interface JobStateRepository {
  save(state: PublishJobState): Promise<void>;
}

export class ConsoleJobStateRepository implements JobStateRepository {
  async save(state: PublishJobState): Promise<void> {
    console.info("publish_job_state", state);
  }
}
