import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PublishQueue } from "../queue/publish-queue";
import type { PostStore } from "./posts";

const publishBodySchema = z.object({
  holaboss_user_id: z.string().min(1)
});

export async function registerPublishRoutes(
  app: FastifyInstance,
  store: PostStore,
  queue: PublishQueue
): Promise<void> {
  app.post("/posts/:id/publish", async (request, reply) => {
    const params = request.params as { id?: string };
    const postId = params.id;
    if (!postId || !store.byId.has(postId)) {
      return reply.code(404).send({ error: "post not found" });
    }

    const parsedBody = publishBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "holaboss_user_id is required" });
    }

    const post = store.byId.get(postId)!;
    post.status = "queued";
    post.updated_at = new Date().toISOString();

    await queue.enqueue({
      post_id: post.id,
      content: post.content,
      holaboss_user_id: parsedBody.data.holaboss_user_id
    });

    return reply.code(202).send({
      post_id: post.id,
      status: post.status
    });
  });
}
