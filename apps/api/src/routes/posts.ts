import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PostRecord } from "../domain/types";

const createPostSchema = z.object({
  content: z.string().min(1)
});

export interface PostStore {
  byId: Map<string, PostRecord>;
}

export async function registerPostRoutes(app: FastifyInstance, store: PostStore): Promise<void> {
  app.post("/posts", async (request, reply) => {
    const parseResult = createPostSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: "content is required" });
    }

    const now = new Date().toISOString();
    const post: PostRecord = {
      id: randomUUID(),
      content: parseResult.data.content,
      status: "draft",
      created_at: now,
      updated_at: now
    };
    store.byId.set(post.id, post);
    return reply.code(201).send(post);
  });

  app.get("/posts", async () => {
    return Array.from(store.byId.values());
  });

  app.get("/posts/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }

    return store.byId.get(postId);
  });
}
