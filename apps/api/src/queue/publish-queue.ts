import type { PublishQueuePayload } from "../domain/types";

export interface PublishQueue {
  enqueue(payload: PublishQueuePayload): Promise<void>;
  schedule(payload: PublishQueuePayload, cron: string): Promise<void>;
}

export class NoopPublishQueue implements PublishQueue {
  async enqueue(_payload: PublishQueuePayload): Promise<void> {
    return;
  }

  async schedule(_payload: PublishQueuePayload, _cron: string): Promise<void> {
    return;
  }
}
