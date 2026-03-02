import { describe, expect, it } from "vitest";

describe("MCP health endpoint", () => {
  it("GET /mcp/health returns ok", async () => {
    const port = 13099;
    const { startMcpServer } = await import("../src/mcp/server");
    const { NoopPublishQueue } = await import("../src/queue/publish-queue");
    const { sharedPostStore } = await import("../src/store/post-store");

    const server = await startMcpServer({ port, store: sharedPostStore, queue: new NoopPublishQueue() });
    const res = await fetch(`http://127.0.0.1:${port}/mcp/health`);
    const body = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    server.close();
  });
});
