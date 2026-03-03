import type { PublishQueuePayload } from "../domain/types";

export interface PublishQueue {
  enqueue(payload: PublishQueuePayload): Promise<void>;
  getStats(): Promise<{ queued: number; publishing: number; failed: number }>;
  close(): Promise<void>;
}

export class NoopPublishQueue implements PublishQueue {
  async enqueue(_payload: PublishQueuePayload): Promise<void> {
    return;
  }

  async getStats(): Promise<{ queued: number; publishing: number; failed: number }> {
    return { queued: 0, publishing: 0, failed: 0 };
  }

  async close(): Promise<void> {
    return;
  }
}
