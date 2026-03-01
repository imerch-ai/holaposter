# postsyncer-app

Sandbox-runnable postsyncer Tier1 MVP.

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

4. Stop runtime stack:

```bash
docker compose down -v
```
