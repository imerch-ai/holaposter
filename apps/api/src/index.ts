import { buildServer } from "./server";
import { BullMqPublishQueue } from "./queue/bullmq-publish-queue";
import { sharedPostStore } from "./store/post-store";

async function start() {
  const port = Number(process.env.PORT ?? "8080");
  const host = process.env.HOST ?? "0.0.0.0";
  const queue = new BullMqPublishQueue();
  const app = buildServer({ queue, store: sharedPostStore });

  try {
    await app.listen({ host, port });
    console.info("postsyncer_api_started", { host, port });
  } catch (error) {
    console.error("postsyncer_api_start_failed", { error });
    await queue.close();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.info("postsyncer_api_shutdown", { signal });
    await app.close();
    await queue.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void start();
