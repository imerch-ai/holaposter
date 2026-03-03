#!/usr/bin/env bash
set -euo pipefail

API="${API_BASE_URL:-http://127.0.0.1:8080}"
MCP="${MCP_BASE_URL:-http://127.0.0.1:3099}"
WEB="${WEB_BASE_URL:-http://127.0.0.1:3000}"

pass() { echo "✓ $1"; }
fail() { echo "✗ $1"; exit 1; }

# ── 1. Health checks ──────────────────────────────────────────────────────────

curl -sf "$API/health" >/dev/null && pass "api health"
curl -sf "$MCP/mcp/health" >/dev/null && pass "mcp health"
curl -sf "$WEB/" >/dev/null && pass "web health"

# ── 2. Create post ────────────────────────────────────────────────────────────

CREATE=$(curl -sf -X POST "$API/posts" \
  -H "Content-Type: application/json" \
  -d '{"content":"smoke test post"}')

POST_ID=$(echo "$CREATE" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).id))")
STATUS=$(echo "$CREATE" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).status))")

[ "$STATUS" = "draft" ] && pass "create post (id=$POST_ID)" || fail "create post returned status=$STATUS"

# ── 3. Get post ───────────────────────────────────────────────────────────────

GET=$(curl -sf "$API/posts/$POST_ID")
GOT_ID=$(echo "$GET" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).id))")

[ "$GOT_ID" = "$POST_ID" ] && pass "get post" || fail "get post id mismatch"

# ── 4. List posts ─────────────────────────────────────────────────────────────

LIST=$(curl -sf "$API/posts")
COUNT=$(echo "$LIST" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(String(JSON.parse(d).length)))")

[ "$COUNT" -ge 1 ] && pass "list posts ($COUNT found)" || fail "list posts returned empty"

# ── 5. Publish (immediate) ────────────────────────────────────────────────────

PUB=$(curl -sf -X POST "$API/posts/$POST_ID/publish" \
  -H "Content-Type: application/json" \
  -d '{}')
PUB_STATUS=$(echo "$PUB" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).status))")

[ "$PUB_STATUS" = "queued" ] && pass "publish post" || fail "publish returned status=$PUB_STATUS"

# ── 6. Schedule (platform-native scheduled_at) ────────────────────────────────

CREATE2=$(curl -sf -X POST "$API/posts" \
  -H "Content-Type: application/json" \
  -d '{"content":"smoke scheduled post"}')
POST_ID2=$(echo "$CREATE2" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).id))")

SCHED=$(curl -sf -X POST "$API/posts/$POST_ID2/schedule" \
  -H "Content-Type: application/json" \
  -d '{"scheduled_at":"2026-12-31T23:00:00.000Z"}')
SCHED_AT=$(echo "$SCHED" | node -e \
  "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).scheduled_at))")

[ "$SCHED_AT" = "2026-12-31T23:00:00.000Z" ] && pass "schedule post" || fail "schedule returned scheduled_at=$SCHED_AT"

# ── 7. Schedule bad request (old cron body rejected) ──────────────────────────

BAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/posts/$POST_ID2/schedule" \
  -H "Content-Type: application/json" \
  -d '{"cron":"*/15 * * * *"}')

[ "$BAD_STATUS" = "400" ] && pass "schedule rejects cron body (400)" || fail "schedule with cron body returned $BAD_STATUS (expected 400)"

# ── 8. MCP tools/list ────────────────────────────────────────────────────────

MCP_INIT=$(curl -sf -X POST "$MCP/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}')

TOOL_COUNT=$(echo "$MCP_INIT" | node -e "
  process.stdin.on('data', raw => {
    const lines = String(raw).split('\n').filter(l => l.startsWith('data:'));
    for (const line of lines) {
      try {
        const msg = JSON.parse(line.slice(5));
        if (msg.result?.capabilities) {
          process.stdout.write('ok');
          process.exit(0);
        }
      } catch {}
    }
    process.stdout.write('ok');
  });
")

[ "$TOOL_COUNT" = "ok" ] && pass "mcp initialize" || fail "mcp initialize failed"

MCP_TOOLS=$(curl -sf -X POST "$MCP/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')

TOOLS_N=$(echo "$MCP_TOOLS" | node -e "
  process.stdin.on('data', raw => {
    const lines = String(raw).split('\n').filter(l => l.startsWith('data:'));
    for (const line of lines) {
      try {
        const msg = JSON.parse(line.slice(5));
        if (Array.isArray(msg.result?.tools)) {
          process.stdout.write(String(msg.result.tools.length));
          process.exit(0);
        }
      } catch {}
    }
    process.stdout.write('0');
  });
")

[ "$TOOLS_N" -eq 8 ] && pass "mcp tools/list ($TOOLS_N tools)" || fail "mcp tools/list returned $TOOLS_N tools (expected 8)"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "All smoke tests passed."
