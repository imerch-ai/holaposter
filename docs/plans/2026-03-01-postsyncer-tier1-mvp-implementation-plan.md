# Postsyncer Sandbox Tier1 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a sandbox-runnable postsyncer website application that supports draft content creation, queued publishing, scheduled publishing, and X destination publishing via platform-managed credentials.

**Architecture:** Build a TypeScript monorepo with three app processes (`web`, `api`, `worker`) plus `redis` and `postgres` in Docker Compose. Keep business logic in app repo; keep platform orchestration outside this repo. Enforce one runtime contract with `app.runtime.yaml` and a validator package used by API/worker.

**Tech Stack:** Node.js 20, TypeScript, React + Vite, Fastify, BullMQ, Redis, Postgres, Vitest, Supertest, Docker Compose, Zod.

---

## Task 1: Bootstrap Monorepo Skeleton

**Files:**
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `apps/api/package.json`
- Create: `apps/worker/package.json`
- Create: `apps/web/package.json`
- Create: `packages/runtime-contract/package.json`
- Create: `README.md`

**Step 1: Write the failing test**

Create `apps/api/test/bootstrap.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("repo bootstrap", () => {
  it("has workspace root package name", async () => {
    const pkg = await import("../../../package.json");
    expect(pkg.name).toBe("postsyncer-app");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (missing package/workspace scripts).

**Step 3: Write minimal implementation**

- Create root `package.json` with npm workspaces:
  - `"workspaces": ["apps/*", "packages/*"]`
  - scripts: `build`, `dev`, `test`, `lint`
- Create package manifests for `@postsyncer/api`, `@postsyncer/worker`, `@postsyncer/web`, `@postsyncer/runtime-contract`.
- Add `.nvmrc` with `20`.
- Add `.gitignore` with `node_modules`, `dist`, `.env*`, `.DS_Store`, `.vite`, `.turbo`.

**Step 4: Run test to verify it passes**

Run: `npm install && npm run test --workspace @postsyncer/api`
Expected: PASS.

**Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap postsyncer monorepo skeleton"
```

---

## Task 2: Define Runtime Contract (`app.runtime.yaml`) and Validator

**Files:**
- Create: `app.runtime.yaml`
- Create: `packages/runtime-contract/src/schema.ts`
- Create: `packages/runtime-contract/src/load.ts`
- Create: `packages/runtime-contract/src/index.ts`
- Create: `packages/runtime-contract/test/runtime-contract.test.ts`

**Step 1: Write the failing test**

Create `packages/runtime-contract/test/runtime-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadRuntimeContract } from "../src/load";

describe("runtime contract", () => {
  it("loads and validates app.runtime.yaml", async () => {
    const contract = await loadRuntimeContract(process.cwd() + "/app.runtime.yaml");
    expect(contract.integration.destination).toBe("x");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/runtime-contract`
Expected: FAIL (`loadRuntimeContract` missing).

**Step 3: Write minimal implementation**

- Add Zod schema for required fields:
  - `app_id`, `name`, `slug`
  - `services` (`web`, `api`, `worker`, `redis`, `postgres`)
  - `healthchecks`
  - `jobs`
  - `integration.destination = "x"`
  - `integration.credential_source = "platform"`
  - `integration.holaboss_user_id_required = true`
- Implement YAML loader + validator (`yaml` package).
- Create concrete `app.runtime.yaml` matching schema.

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @postsyncer/runtime-contract`
Expected: PASS.

**Step 5: Commit**

```bash
git add app.runtime.yaml packages/runtime-contract
git commit -m "feat: add runtime contract schema and loader"
```

---

## Task 3: API Service for Drafts and Queue Requests

**Files:**
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/posts.ts`
- Create: `apps/api/src/routes/publish.ts`
- Create: `apps/api/src/domain/types.ts`
- Create: `apps/api/src/queue/publish-queue.ts`
- Create: `apps/api/test/health.test.ts`
- Create: `apps/api/test/publish.test.ts`

**Step 1: Write the failing test**

Create `apps/api/test/health.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = buildServer();
    const res = await request(app.server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
```

Create `apps/api/test/publish.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server";

describe("POST /posts/:id/publish", () => {
  it("queues publish job and returns queued", async () => {
    const app = buildServer();
    const create = await request(app.server).post("/posts").send({ content: "hello x" });
    const postId = create.body.id;
    const res = await request(app.server).post(`/posts/${postId}/publish`).send({ holaboss_user_id: "u1" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/api`
Expected: FAIL (`buildServer` missing / routes missing).

**Step 3: Write minimal implementation**

- Build Fastify app with:
  - `GET /health`
  - `POST /posts` (in-memory store for Task 3; DB in later task)
  - `POST /posts/:id/publish` (enqueue queue message, set status to `queued`)
- Add queue adapter interface in `publish-queue.ts` (BullMQ impl comes later).

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @postsyncer/api`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add api health, posts, and publish queue endpoint"
```

---

## Task 4: Worker with BullMQ Publish Pipeline

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/queue.ts`
- Create: `apps/worker/src/pipeline/process-publish-job.ts`
- Create: `apps/worker/src/integration/x-publisher.ts`
- Create: `apps/worker/src/repository/job-state-repo.ts`
- Create: `apps/worker/test/process-publish-job.test.ts`

**Step 1: Write the failing test**

Create `apps/worker/test/process-publish-job.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { processPublishJob } from "../src/pipeline/process-publish-job";

describe("processPublishJob", () => {
  it("publishes and marks job published", async () => {
    const publish = vi.fn().mockResolvedValue({ external_post_id: "x123" });
    const save = vi.fn().mockResolvedValue(undefined);
    await processPublishJob(
      { post_id: "p1", holaboss_user_id: "u1", content: "hello" },
      { publishToX: publish, saveJobState: save }
    );
    expect(publish).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/worker`
Expected: FAIL (`processPublishJob` missing).

**Step 3: Write minimal implementation**

- Implement BullMQ worker bootstrap with queue name from runtime contract.
- Implement `processPublishJob`:
  - set `publishing`
  - call platform X API adapter using `holaboss_user_id`
  - set `published` or `failed`
- Implement retries with BullMQ backoff in queue config.

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @postsyncer/worker`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat: add worker publish pipeline with x adapter and retries"
```

---

## Task 5: Web SPA for Drafts and Publish Status

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/PostComposer.tsx`
- Create: `apps/web/src/components/PublishList.tsx`
- Create: `apps/web/test/app.test.tsx`

**Step 1: Write the failing test**

Create `apps/web/test/app.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("App", () => {
  it("shows create post form", () => {
    render(<App />);
    expect(screen.getByText("Create Draft")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/web`
Expected: FAIL (`App` missing).

**Step 3: Write minimal implementation**

- Build minimal SPA:
  - textarea + submit for draft creation
  - list of posts with status chip
  - publish button per draft
- API client points to `VITE_API_BASE_URL`.

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @postsyncer/web`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add web spa for draft creation and publish actions"
```

---

## Task 6: Docker Compose Runtime Bring-Up

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `.env.example`
- Create: `scripts/doctor.ts`
- Create: `scripts/smoke-runtime.sh`

**Step 1: Write the failing test**

Create `scripts/smoke-runtime.sh` with expected checks (initially failing):

```bash
#!/usr/bin/env bash
set -euo pipefail
curl -sf http://localhost:8080/health >/dev/null
curl -sf http://localhost:3000 >/dev/null
```

**Step 2: Run test to verify it fails**

Run:
- `docker compose up -d --build`
- `bash scripts/smoke-runtime.sh`
Expected: FAIL (services not yet defined correctly).

**Step 3: Write minimal implementation**

- Add compose services:
  - `web` on `3000`
  - `api` on `8080`
  - `worker`
  - `redis`
  - `postgres`
- Add health checks for `web`, `api`, and worker liveliness command.
- Add `doctor.ts` to print service/queue/basic DB checks.

**Step 4: Run test to verify it passes**

Run:
- `docker compose up -d --build`
- `bash scripts/smoke-runtime.sh`
Expected: PASS.

**Step 5: Commit**

```bash
git add docker-compose.yml apps/*/Dockerfile .env.example scripts
git commit -m "feat: add docker compose runtime stack with health checks"
```

---

## Task 7: End-to-End Publish and Schedule Acceptance

**Files:**
- Create: `test/e2e/publish-flow.test.ts`
- Create: `test/e2e/schedule-flow.test.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

Create `test/e2e/publish-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("publish flow", () => {
  it("moves draft to published", async () => {
    // call api endpoints in sequence; assert final status
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL (`expected true to be false`).

**Step 3: Write minimal implementation**

- Implement real E2E test flow:
  - create draft
  - enqueue publish
  - poll job/post status
  - assert terminal state `published` (or `failed` with normalized error in negative test)
- Add schedule E2E:
  - register repeat job
  - assert at least one publish attempt created.
- Document runbook in `README.md`.

**Step 4: Run test to verify it passes**

Run:
- `docker compose up -d --build`
- `npm run test:e2e`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/e2e README.md
git commit -m "test: add e2e publish and schedule acceptance coverage"
```

---

## Task 8: Operational Hardening and Final Verification

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/worker/src/index.ts`
- Create: `docs/operations.md`
- Create: `docs/troubleshooting.md`

**Step 1: Write the failing test**

Add one failure-path test in `apps/worker/test/process-publish-job.test.ts`:

```ts
it("marks failed after publish error", async () => {
  // arrange mocked x publish throw
  // assert status becomes failed with error code/message
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @postsyncer/worker`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Normalize integration errors and record actionable failure payload.
- Ensure logs include `workspace_id`, `app_slug`, `job_id`, `holaboss_user_id`.
- Add docs for restart, queue drain, and failed publish debugging.

**Step 4: Run test to verify it passes**

Run:
- `npm run test`
- `npm run test:e2e`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api apps/worker docs
git commit -m "chore: harden observability and failure diagnostics"
```

---

## Verification Checklist

- `docker compose up -d --build` starts all services healthy.
- `POST /posts` and `POST /posts/:id/publish` complete queue handoff.
- Worker publishes to X integration adapter using `holaboss_user_id`.
- Repeatable jobs enqueue and execute automatically.
- Logs and state traces allow triaging failures without attaching a debugger.

## Notes for Execution

- Keep steps DRY and YAGNI; do not add source integrations in MVP.
- Keep commits small and task-scoped.
- If runtime contract evolves, update both schema and `app.runtime.yaml` in same commit.
- Use @superpowers:test-driven-development discipline inside each task.
- Use @superpowers:verification-before-completion before claiming MVP done.

