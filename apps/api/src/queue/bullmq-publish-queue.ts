import { Queue } from "bullmq";

import type { PublishQueuePayload } from "../domain/types";
import type { PublishQueue } from "./publish-queue";

const queueName = process.env.PUBLISH_QUEUE_NAME ?? "publish_queue";
const redisHost = process.env.REDIS_HOST ?? "127.0.0.1";
const redisPort = Number(process.env.REDIS_PORT ?? "6379");

export class BullMqPublishQueue implements PublishQueue {
  private readonly queue: Queue<PublishQueuePayload>;

  constructor() {
    this.queue = new Queue<PublishQueuePayload>(queueName, {
      connection: { host: redisHost, port: redisPort },
      defaultJobOptions: {
        attempts: Number(process.env.PUBLISH_RETRY_ATTEMPTS ?? "5"),
        backoff: {
          type: "exponential",
          delay: Number(process.env.PUBLISH_RETRY_BACKOFF_MS ?? "1000")
        }
      }
    });
  }

  async enqueue(payload: PublishQueuePayload): Promise<void> {
    await this.queue.add("publish_post", payload);
  }

  async schedule(payload: PublishQueuePayload, cron: string): Promise<void> {
    await this.queue.add("publish_post", payload, {
      jobId: `schedule:${payload.post_id}:${payload.holaboss_user_id}:${Buffer.from(cron).toString("base64url")}`,
      repeat: {
        pattern: cron
      }
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
