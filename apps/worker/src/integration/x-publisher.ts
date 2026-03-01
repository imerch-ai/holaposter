export interface PublishToXInput {
  holaboss_user_id: string;
  content: string;
}

export interface PublishToXOutput {
  external_post_id: string;
}

export interface XPublisher {
  publishToX(input: PublishToXInput): Promise<PublishToXOutput>;
}

export class PlatformXPublisher implements XPublisher {
  private readonly workspaceApiUrl: string;
  private readonly integrationId: string;
  private readonly integrationToken: string;

  constructor() {
    const rawWorkspaceApiUrl = process.env.WORKSPACE_API_URL ?? "http://localhost:3033";
    this.workspaceApiUrl = rawWorkspaceApiUrl.replace(/\/+$/, "");
    this.integrationId = process.env.WORKSPACE_X_INTEGRATION_ID ?? "";
    this.integrationToken = process.env.PLATFORM_INTEGRATION_TOKEN ?? "";
  }

  async publishToX(input: PublishToXInput): Promise<PublishToXOutput> {
    if (!this.integrationId) {
      throw new Error("x_publish_failed:missing_integration_id_config");
    }

    const createDraftResponse = await fetch(
      `${this.workspaceApiUrl}/api/posts/drafts?userId=${encodeURIComponent(input.holaboss_user_id)}`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          provider: "twitter-xdnq",
          integrationId: this.integrationId,
          content: input.content,
          directSend: false
        })
      }
    );

    if (!createDraftResponse.ok) {
      const body = await createDraftResponse.text();
      throw new Error(`x_publish_failed:create_draft:${createDraftResponse.status}:${body}`);
    }

    const createDraftPayload = (await createDraftResponse.json()) as {
      postId?: string;
      id?: string;
    };
    const draftId = createDraftPayload.postId ?? createDraftPayload.id;
    if (!draftId) {
      throw new Error("x_publish_failed:missing_draft_id");
    }

    const publishResponse = await fetch(`${this.workspaceApiUrl}/api/posts/drafts/${draftId}/publish`, {
      method: "PUT",
      headers: this.buildHeaders(),
      body: JSON.stringify({ userId: input.holaboss_user_id })
    });

    if (!publishResponse.ok) {
      const body = await publishResponse.text();
      throw new Error(`x_publish_failed:publish_draft:${publishResponse.status}:${body}`);
    }

    const publishPayload = (await publishResponse.json()) as {
      external_post_id?: string;
      externalPostId?: string;
      postId?: string;
      id?: string;
      data?: {
        external_post_id?: string;
        externalPostId?: string;
        postId?: string;
        id?: string;
      };
    };
    const externalPostId =
      publishPayload.external_post_id ??
      publishPayload.externalPostId ??
      publishPayload.postId ??
      publishPayload.id ??
      publishPayload.data?.external_post_id ??
      publishPayload.data?.externalPostId ??
      publishPayload.data?.postId ??
      publishPayload.data?.id ??
      draftId;
    if (!externalPostId) {
      throw new Error("x_publish_failed:missing_external_post_id");
    }

    return { external_post_id: externalPostId };
  }

  private buildHeaders() {
    return {
      "Content-Type": "application/json",
      ...(this.integrationToken ? { Authorization: `Bearer ${this.integrationToken}` } : {})
    };
  }
}
