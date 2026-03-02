import { z } from "zod";

const serviceSchema = z.object({
  build: z.string().optional(),
  start: z.string().optional(),
  image: z.string().optional()
});

const servicesSchema = z.object({
  web: serviceSchema,
  api: serviceSchema,
  worker: serviceSchema,
  redis: serviceSchema,
  postgres: serviceSchema
});

const healthcheckSchema = z.object({
  path: z.string(),
  timeout_s: z.number().int().positive()
});

const jobsSchema = z.object({
  queue_name: z.string().min(1),
  retry_attempts: z.number().int().nonnegative(),
  retry_backoff_ms: z.number().int().nonnegative(),
  repeat_cron: z.string().min(1),
  concurrency: z.number().int().positive()
});

const integrationSchema = z.object({
  destination: z.literal("x"),
  credential_source: z.literal("platform"),
  holaboss_user_id_required: z.literal(true)
});

const mcpSchema = z.object({
  enabled: z.boolean(),
  transport: z.literal("http-sse"),
  port: z.number().int().positive(),
  path: z.string().min(1)
}).optional();

export const runtimeContractSchema = z.object({
  app_id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  services: servicesSchema,
  healthchecks: z.object({
    web: healthcheckSchema,
    api: healthcheckSchema,
    worker: healthcheckSchema,
    mcp: healthcheckSchema.optional()
  }),
  jobs: jobsSchema,
  integration: integrationSchema,
  env_contract: z.array(z.string().min(1)).min(1),
  mcp: mcpSchema
});

export type RuntimeContract = z.infer<typeof runtimeContractSchema>;
