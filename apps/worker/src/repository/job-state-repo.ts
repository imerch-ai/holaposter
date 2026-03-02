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

export class HttpJobStateRepository implements JobStateRepository {
  private readonly callbackUrl: string;
  private readonly token: string;

  constructor() {
    const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://api:8080";
    this.callbackUrl = `${apiBaseUrl.replace(/\/+$/, "")}/internal/job-states`;
    this.token = process.env.INTERNAL_API_TOKEN ?? "";
  }

  async save(state: PublishJobState): Promise<void> {
    const response = await fetch(this.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify(state)
    });

    if (response.status === 404) {
      // Post no longer exists in API memory (e.g. after restart). Skip silently.
      console.warn("job_state_sync_skipped:post_not_found", { post_id: state.post_id });
      return;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`job_state_sync_failed:${response.status}:${body}`);
    }
  }
}

export class CompositeJobStateRepository implements JobStateRepository {
  private readonly repositories: JobStateRepository[];

  constructor(repositories: JobStateRepository[]) {
    this.repositories = repositories;
  }

  async save(state: PublishJobState): Promise<void> {
    for (const repository of this.repositories) {
      await repository.save(state);
    }
  }
}
