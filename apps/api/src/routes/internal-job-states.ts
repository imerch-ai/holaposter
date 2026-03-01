import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PostStatus } from "../domain/types";
import type { PostStore } from "./posts";

const jobStateSchema = z.object({
  post_id: z.string().min(1),
  holaboss_user_id: z.string().min(1),
  status: z.enum(["publishing", "published", "failed"]),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  external_post_id: z.string().optional()
});

export async function registerInternalJobStateRoutes(app: FastifyInstance, store: PostStore): Promise<void> {
  app.post("/internal/job-states", async (request, reply) => {
    const parsed = jobStateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid job state payload" });
    }

    const post = store.byId.get(parsed.data.post_id);
    if (!post) {
      return reply.code(404).send({ error: "post not found" });
    }

    post.status = parsed.data.status as PostStatus;
    post.updated_at = new Date().toISOString();
    post.error_code = parsed.data.error_code;
    post.error_message = parsed.data.error_message;
    post.external_post_id = parsed.data.external_post_id;

    return reply.code(200).send({ ok: true });
  });
}
