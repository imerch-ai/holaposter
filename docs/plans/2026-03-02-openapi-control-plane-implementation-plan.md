# HolaPoster OpenAPI Control Plane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define and implement a closed-loop control route where sandbox agents control HolaPoster via OpenAPI-standard APIs (without requiring app developers to expose MCP directly).

**Architecture:** Keep two contracts: `app.runtime.yaml` for runtime lifecycle and `app.control.openapi.yaml` for control operations. Platform/agent side reads OpenAPI, converts operations into tool calls, and executes against app control endpoints via sandbox-scoped networking. Use idempotency, standardized error codes, and auditable request metadata to guarantee safe agent automation.

**Tech Stack:** OpenAPI 3.1, Fastify, TypeScript, Zod, Vitest, Python FastAPI backend, pytest, sandbox runtime client, HTTP tool adapter.

---

## Task 1: Freeze Control API Standard (OpenAPI-first)

**Files:**
- Create: `docs/specs/app-control-openapi-v1.md`
- Create: `apps/api/openapi/app.control.openapi.yaml`
- Test: `apps/api/test/openapi-contract.test.ts`

**Step 1: Write the failing test**
- Add `openapi-contract.test.ts` asserting spec has required operations:
  - `POST /control/v1/posts`
  - `POST /control/v1/posts/{post_id}/publish`
  - `POST /control/v1/posts/{post_id}/schedule`
  - `GET /control/v1/posts/{post_id}`
  - `GET /control/v1/posts`

**Step 2: Run test to verify it fails**
- Run: `npm run test --workspace @postsyncer/api -- openapi-contract.test.ts`
- Expected: FAIL (`app.control.openapi.yaml` missing).

**Step 3: Write minimal implementation**
- Add `app.control.openapi.yaml` with request/response schemas.
- Define common headers:
  - `X-Request-Id`
  - `Idempotency-Key`
- Define common envelope:
  - success: `{ status, data, request_id }`
  - error: `{ error_code, error_message, retryable, request_id }`

**Step 4: Run test to verify it passes**
- Run same test command; expected PASS.

**Step 5: Commit**
- `git commit -m "spec: add holaposter control openapi v1"`

---

## Task 2: Bind Runtime Contract to Control API Discovery

**Files:**
- Modify: `app.runtime.yaml`
- Modify: `packages/runtime-contract/src/schema.ts`
- Modify: `packages/runtime-contract/test/runtime-contract.test.ts`

**Step 1: Write the failing test**
- Add assertions that runtime contract includes control metadata:
  - `control_api.openapi_path`
  - `control_api.base_path`
  - `control_api.auth`

**Step 2: Run test to verify it fails**
- Run: `npm run test --workspace @postsyncer/runtime-contract`
- Expected: FAIL (missing schema fields).

**Step 3: Write minimal implementation**
- Extend schema and `app.runtime.yaml`:
  - `control_api.openapi_path: /control/v1/openapi.json`
  - `control_api.base_path: /control/v1`
  - `control_api.auth: bearer|internal_token`

**Step 4: Run test to verify it passes**
- Run runtime-contract tests; expected PASS.

**Step 5: Commit**
- `git commit -m "feat: add control api discovery to runtime contract"`

---

## Task 3: Implement Control Endpoints in HolaPoster API

**Files:**
- Create: `apps/api/src/routes/control.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/posts.ts`
- Modify: `apps/api/src/routes/publish.ts`
- Test: `apps/api/test/control-api.test.ts`

**Step 1: Write the failing test**
- Add tests for each control endpoint:
  - create draft
  - publish now
  - schedule
  - read one
  - list recent
- Assert response envelope and error envelope shape.

**Step 2: Run test to verify it fails**
- Run: `npm run test --workspace @postsyncer/api -- control-api.test.ts`
- Expected: FAIL (route missing).

**Step 3: Write minimal implementation**
- Implement `/control/v1/*` routes as thin adapters over existing domain logic.
- Enforce `holaboss_user_id` validation.
- Ensure all responses include `request_id`.

**Step 4: Run test to verify it passes**
- Run control-api tests; expected PASS.

**Step 5: Commit**
- `git commit -m "feat: add openapi control endpoints for agent actions"`

---

## Task 4: Add Idempotency + Standard Error Codes

**Files:**
- Create: `apps/api/src/domain/error-codes.ts`
- Create: `apps/api/src/middleware/idempotency.ts`
- Modify: `apps/api/src/routes/control.ts`
- Test: `apps/api/test/idempotency.test.ts`

**Step 1: Write the failing test**
- Add tests:
  - same `Idempotency-Key` on publish returns same semantic result
  - validation errors return `validation_error`
  - integration binding errors return `integration_not_bound`

**Step 2: Run test to verify it fails**
- Run: `npm run test --workspace @postsyncer/api -- idempotency.test.ts`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Implement idempotency store (MVP in-memory + clear TODO for Redis-backed version).
- Map internal errors to stable external codes:
  - `validation_error`
  - `not_found`
  - `integration_not_bound`
  - `publish_failed`
  - `retry_exhausted`

**Step 4: Run test to verify it passes**
- Run targeted tests and full API tests.

**Step 5: Commit**
- `git commit -m "feat: add idempotency and standardized control error codes"`

---

## Task 5: Publish OpenAPI Document from Running App

**Files:**
- Create: `apps/api/src/routes/openapi.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/openapi-endpoint.test.ts`

**Step 1: Write the failing test**
- Assert `GET /control/v1/openapi.json` returns valid JSON OpenAPI with expected paths.

**Step 2: Run test to verify it fails**
- Run: `npm run test --workspace @postsyncer/api -- openapi-endpoint.test.ts`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Serve embedded `app.control.openapi.yaml` as JSON at runtime.
- Add cache headers for safe polling by platform.

**Step 4: Run test to verify it passes**
- Run targeted and full API tests.

**Step 5: Commit**
- `git commit -m "feat: expose control openapi endpoint"`

---

## Task 6: Platform Adapter in `backend` (OpenAPI -> Agent Tools)

**Files:**
- Create: `../backend/src/services/application_control/openapi_loader.py`
- Create: `../backend/src/services/application_control/tool_registry.py`
- Create: `../backend/src/services/application_control/control_client.py`
- Create: `../backend/test/services/application_control/test_openapi_loader.py`
- Create: `../backend/test/services/application_control/test_tool_registry.py`

**Step 1: Write the failing tests**
- Loader test: parse app OpenAPI and resolve supported operations.
- Registry test: generate tool definitions with JSON schema from OpenAPI operations.

**Step 2: Run test to verify it fails**
- Run: `cd ../backend && uv run pytest test/services/application_control -q`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Implement loader with allowed-operation filter (only whitelisted control ops).
- Build tool registry that maps operationId -> callable metadata.

**Step 4: Run test to verify it passes**
- Run same pytest command; expected PASS.

**Step 5: Commit**
- Commit in backend repo: `feat: add openapi-based application control adapter`

---

## Task 7: Sandbox Execution Bridge + AuthN/AuthZ

**Files:**
- Modify: `../backend/src/services/workspaces/sandbox_runtime_client.py`
- Create: `../backend/src/services/application_control/executor.py`
- Modify: `../backend/src/api/v1/sandbox_runtime/routes/sandbox.py`
- Test: `../backend/test/api/v1/sandbox_runtime/test_api.py`

**Step 1: Write the failing tests**
- API tests for:
  - invoke tool against workspace app
  - deny non-whitelisted operation
  - reject missing workspace scope token

**Step 2: Run test to verify it fails**
- Run: `cd ../backend && uv run pytest test/api/v1/sandbox_runtime/test_api.py -q`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Add executor that calls app control API inside workspace scope.
- Inject per-request auth and trace headers.
- Record audit fields: `workspace_id`, `agent_id`, `tool_name`, `request_id`, `outcome`.

**Step 4: Run test to verify it passes**
- Run targeted tests; expected PASS.

**Step 5: Commit**
- Commit in backend repo: `feat: add sandbox app control executor with policy checks`

---

## Task 8: End-to-End Closed-Loop Validation

**Files:**
- Create: `test/e2e/agent-control-publish-flow.test.ts` (postsyncer-app)
- Create: `../backend/scripts/test-agent-openapi-control.py`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-01-postsyncer-tier1-mvp-implementation-plan.md`

**Step 1: Write the failing E2E test**
- Flow:
  - create draft via control API tool
  - publish now via tool
  - poll status until `published`
  - schedule another draft via tool

**Step 2: Run test to verify it fails**
- Run app E2E + backend script; expected FAIL until adapter is wired.

**Step 3: Write minimal implementation glue**
- Add test runner config/env docs.
- Ensure required envs exist in `.env.example` for both repos.

**Step 4: Run verification to pass**
- `npm run test`
- `npm run build`
- `npm run doctor`
- `npm run smoke:runtime`
- `cd ../backend && uv run pytest test/services/application_control test/api/v1/sandbox_runtime/test_api.py -q`

**Step 5: Commit**
- Commit app and backend docs/tests separately with clear messages.

---

## Task 9: Rollout Guardrails (MVP Production Safety)

**Files:**
- Create: `docs/specs/app-control-error-codes.md`
- Create: `docs/specs/app-control-security-checklist.md`
- Modify: `README.md`

**Step 1: Write failing docs checklist gate**
- Add CI check script placeholder verifying required docs exist.

**Step 2: Run check to fail**
- Run docs check; expected FAIL if files absent.

**Step 3: Write minimal implementation**
- Document:
  - error code contract
  - approval boundaries (`publish/schedule/cancel`)
  - idempotency requirements
  - observability minimum fields

**Step 4: Run check to pass**
- Run docs check; expected PASS.

**Step 5: Commit**
- `git commit -m "docs: add control plane error and security guardrails"`
