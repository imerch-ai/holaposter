# holaposter-app

Sandbox-runnable HolaPoster Tier1 MVP.

This repository contains the application runtime code (`web`, `api`, `worker`) and shared runtime contract package.

## Runtime Bring-up

1. Copy `.env.example` to `.env` and fill in integration values if needed.
2. Start runtime stack:

```bash
docker compose up -d --build
```

3. Run smoke checks:

```bash
bash scripts/smoke-runtime.sh
npm run doctor
```

4. Run e2e acceptance checks (compose stack must stay up):

```bash
npm run test:e2e
```

If `WORKSPACE_X_INTEGRATION_ID` or workspace-api connectivity is missing, publish tests may end in `failed` state (still valid terminal behavior for failure-path coverage).

5. Stop runtime stack:

```bash
docker compose down -v
```
