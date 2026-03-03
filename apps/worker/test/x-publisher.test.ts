import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformXPublisher } from "../src/integration/x-publisher";

describe("PlatformXPublisher", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("creates draft then publishes through workspace api", async () => {
    process.env.WORKSPACE_API_URL = "http://workspace-api:3033";
    process.env.WORKSPACE_X_INTEGRATION_ID = "integration-1";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ postId: "draft-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ postId: "published-1" })
      });

    vi.stubGlobal("fetch", fetchMock);

    const publisher = new PlatformXPublisher();
    const result = await publisher.publishToX({ holaboss_user_id: "u1", content: "hello from worker" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://workspace-api:3033/api/posts/drafts?userId=u1",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"integrationId\":\"integration-1\"")
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://workspace-api:3033/api/posts/drafts/draft-1/publish",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ userId: "u1" })
      })
    );
    expect(result).toEqual({ external_post_id: "published-1" });
  });

  it("falls back to draft id when publish response has no external id", async () => {
    process.env.WORKSPACE_API_URL = "http://workspace-api:3033";
    process.env.WORKSPACE_X_INTEGRATION_ID = "integration-1";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ postId: "draft-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "queued" })
      });

    vi.stubGlobal("fetch", fetchMock);

    const publisher = new PlatformXPublisher();
    const result = await publisher.publishToX({ holaboss_user_id: "u1", content: "hello from worker" });

    expect(result).toEqual({ external_post_id: "draft-1" });
  });

  it("fails fast when workspace integration id is missing", async () => {
    process.env.WORKSPACE_API_URL = "http://workspace-api:3033";
    delete process.env.WORKSPACE_X_INTEGRATION_ID;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new PlatformXPublisher();

    await expect(
      publisher.publishToX({ holaboss_user_id: "u1", content: "hello from worker" })
    ).rejects.toThrow("x_publish_failed:missing_integration_id_config");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates draft then sets scheduledDate when scheduled_at is provided", async () => {
    process.env.WORKSPACE_API_URL = "http://workspace-api:3033";
    process.env.WORKSPACE_X_INTEGRATION_ID = "integration-1";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ postId: "draft-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

    vi.stubGlobal("fetch", fetchMock);

    const publisher = new PlatformXPublisher();
    const result = await publisher.publishToX({
      holaboss_user_id: "u1",
      content: "scheduled post",
      scheduled_at: "2026-03-15T14:00:00.000Z"
    });

    // First call: create draft
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://workspace-api:3033/api/posts/drafts?userId=u1",
      expect.objectContaining({ method: "POST" })
    );
    // Second call: set scheduledDate (not /publish)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://workspace-api:3033/api/posts/drafts/draft-1?userId=u1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ scheduledDate: "2026-03-15T14:00:00.000Z" })
      })
    );
    expect(result).toEqual({ external_post_id: "draft-1" });
  });
});
