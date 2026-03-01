import type { PublishQueuePayload } from "../domain/types";

export interface PublishQueue {
  enqueue(payload: PublishQueuePayload): Promise<void>;
}

export class NoopPublishQueue implements PublishQueue {
  async enqueue(_payload: PublishQueuePayload): Promise<void> {
    return;
  }
}
