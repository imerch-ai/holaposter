import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "./posts";

const scheduleBodySchema = z.object({
  cron: z.string().min(1)
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

    return reply.code(202).send({
      post_id: post.id,
      status: post.status
    });
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
      return reply.code(400).send({ error: "cron is required" });
    }

    const post = store.byId.get(postId)!;
    post.status = "queued";
    post.schedule_cron = parsedBody.data.cron;
    post.updated_at = new Date().toISOString();

    await queue.schedule(
      {
        post_id: post.id,
        content: post.content,
        holaboss_user_id
      },
      parsedBody.data.cron
    );

    return reply.code(202).send({
      post_id: post.id,
      status: post.status,
      schedule_cron: post.schedule_cron
    });
  });

  app.delete("/posts/:id/schedule", async (request, reply) => {
    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }
    await queue.unschedule(postId);
    const post = store.byId.get(postId)!;
    post.schedule_cron = undefined;
    post.updated_at = new Date().toISOString();
    return reply.code(200).send({ post_id: postId, schedule_cron: null });
  });
}
