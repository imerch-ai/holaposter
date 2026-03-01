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
  private readonly baseUrl: string;
  private readonly integrationToken: string;

  constructor() {
    this.baseUrl = process.env.PLATFORM_X_API_URL ?? "http://localhost:3033/api/v1/projects/integrations/x";
    this.integrationToken = process.env.PLATFORM_INTEGRATION_TOKEN ?? "";
  }

  async publishToX(input: PublishToXInput): Promise<PublishToXOutput> {
    const response = await fetch(`${this.baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.integrationToken ? { Authorization: `Bearer ${this.integrationToken}` } : {})
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`x_publish_failed:${response.status}:${body}`);
    }

    const payload = (await response.json()) as { external_post_id?: string };
    if (!payload.external_post_id) {
      throw new Error("x_publish_failed:missing_external_post_id");
    }

    return { external_post_id: payload.external_post_id };
  }
}
