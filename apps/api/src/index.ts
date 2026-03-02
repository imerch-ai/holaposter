import { buildServer } from "./server";
import { BullMqPublishQueue } from "./queue/bullmq-publish-queue";
import { sharedPostStore } from "./store/post-store";
import { startMcpServer } from "./mcp/server";

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

  const mcpPort = Number(process.env.MCP_PORT ?? "3099");
  const mcpServer = await startMcpServer({ port: mcpPort, store: sharedPostStore, queue });
  console.info("postsyncer_mcp_started", { port: mcpPort });

  const shutdown = async (signal: string) => {
    console.info("postsyncer_api_shutdown", { signal });
    mcpServer.close();
    await app.close();
    await queue.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void start();
