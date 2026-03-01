import Fastify from "fastify";

import type { PostRecord } from "./domain/types";
import { NoopPublishQueue, type PublishQueue } from "./queue/publish-queue";
import { registerHealthRoutes } from "./routes/health";
import { registerPostRoutes } from "./routes/posts";
import { registerPublishRoutes } from "./routes/publish";

interface BuildServerOptions {
  queue?: PublishQueue;
}

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify();
  const queue = options.queue ?? new NoopPublishQueue();
  const postStore: { byId: Map<string, PostRecord> } = { byId: new Map() };

  void registerHealthRoutes(app);
  void registerPostRoutes(app, postStore);
  void registerPublishRoutes(app, postStore, queue);

  return app;
}
