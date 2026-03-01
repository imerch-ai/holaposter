import { Queue, Worker } from "bullmq";

import { processPublishJob, type PublishJobPayload } from "./pipeline/process-publish-job";
import { PlatformXPublisher } from "./integration/x-publisher";
import { CompositeJobStateRepository, ConsoleJobStateRepository, HttpJobStateRepository } from "./repository/job-state-repo";

const queueName = process.env.PUBLISH_QUEUE_NAME ?? "publish_queue";
const redisHost = process.env.REDIS_HOST ?? "127.0.0.1";
const redisPort = Number(process.env.REDIS_PORT ?? "6379");

const connection = { host: redisHost, port: redisPort };

export function createPublishQueue() {
  return new Queue<PublishJobPayload>(queueName, {
    connection,
    defaultJobOptions: {
      attempts: Number(process.env.PUBLISH_RETRY_ATTEMPTS ?? "5"),
      backoff: {
        type: "exponential",
        delay: Number(process.env.PUBLISH_RETRY_BACKOFF_MS ?? "1000")
      }
    }
  });
}

export function createPublishWorker() {
  const xPublisher = new PlatformXPublisher();
  const jobRepository = new CompositeJobStateRepository([new HttpJobStateRepository(), new ConsoleJobStateRepository()]);

  return new Worker<PublishJobPayload>(
    queueName,
    async (job) => {
      await processPublishJob(job.data, {
        publishToX: (input) => xPublisher.publishToX(input),
        saveJobState: (state) => jobRepository.save(state)
      });
    },
    {
      connection,
      concurrency: Number(process.env.PUBLISH_QUEUE_CONCURRENCY ?? "5")
    }
  );
}
