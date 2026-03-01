import type { XPublisher } from "../integration/x-publisher";
import type { JobStateRepository } from "../repository/job-state-repo";

export interface PublishJobPayload {
  post_id: string;
  holaboss_user_id: string;
  content: string;
}

export interface ProcessPublishDependencies {
  publishToX: XPublisher["publishToX"];
  saveJobState: JobStateRepository["save"];
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
    const published = await deps.publishToX({
      holaboss_user_id: payload.holaboss_user_id,
      content: payload.content
    });

    await deps.saveJobState({
      post_id: payload.post_id,
      holaboss_user_id: payload.holaboss_user_id,
      status: "published",
      external_post_id: published.external_post_id
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
