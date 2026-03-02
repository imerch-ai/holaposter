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

  async unschedule(postId: string, cron?: string): Promise<void> {
    if (!cron) return;
    const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
    const jobId = `schedule:${postId}:${holaboss_user_id}:${Buffer.from(cron).toString("base64url")}`;
    await this.queue.removeRepeatable("publish_post", { pattern: cron }, jobId);
  }

  async getStats(): Promise<{ queued: number; publishing: number; failed: number }> {
    const counts = await this.queue.getJobCounts("wait", "active", "failed");
    return {
      queued: counts.wait ?? 0,
      publishing: counts.active ?? 0,
      failed: counts.failed ?? 0
    };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
