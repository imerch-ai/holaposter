import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "./posts";

const scheduleBodySchema = z.object({
  scheduled_at: z.string().datetime()
});

export async function registerPublishRoutes(
  app: FastifyInstance,
  store: PostStore,
  queue: PublishQueue
): Promise<void> {
  app.post("/posts/:id/publish", async (request, reply) => {
    const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
    if (!holaboss_user_id) {
      return reply.code(503).send({ error: "HOLABOSS_USER_ID not configured" });
    }

    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }

    const post = store.byId.get(postId)!;
    post.status = "queued";
    post.updated_at = new Date().toISOString();

    await queue.enqueue({
      post_id: post.id,
      content: post.content,
      holaboss_user_id
    });

    return reply.code(202).send({ post_id: post.id, status: post.status });
  });

  app.post("/posts/:id/schedule", async (request, reply) => {
    const holaboss_user_id = process.env.HOLABOSS_USER_ID ?? "";
    if (!holaboss_user_id) {
      return reply.code(503).send({ error: "HOLABOSS_USER_ID not configured" });
    }

    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }

    const parsedBody = scheduleBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "scheduled_at is required and must be an ISO datetime" });
    }

    const post = store.byId.get(postId)!;
    post.status = "queued";
    post.scheduled_at = parsedBody.data.scheduled_at;
    post.updated_at = new Date().toISOString();

    await queue.enqueue({
      post_id: post.id,
      content: post.content,
      holaboss_user_id,
      scheduled_at: parsedBody.data.scheduled_at
    });

    return reply.code(202).send({
      post_id: post.id,
      status: post.status,
      scheduled_at: post.scheduled_at
    });
  });
}
