import Fastify from "fastify";
import cors from "@fastify/cors";

import type { PostRecord } from "./domain/types";
import { NoopPublishQueue, type PublishQueue } from "./queue/publish-queue";
import { registerHealthRoutes } from "./routes/health";
import { registerInternalJobStateRoutes } from "./routes/internal-job-states";
import { registerPostRoutes } from "./routes/posts";
import { registerPublishRoutes } from "./routes/publish";

interface BuildServerOptions {
  queue?: PublishQueue;
}

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify();
  const queue = options.queue ?? new NoopPublishQueue();
  const postStore: { byId: Map<string, PostRecord> } = { byId: new Map() };
  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  );

  void app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });

  void registerHealthRoutes(app);
  void registerPostRoutes(app, postStore);
  void registerPublishRoutes(app, postStore, queue);
  void registerInternalJobStateRoutes(app, postStore);

  return app;
}
