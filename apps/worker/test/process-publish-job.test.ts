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
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ status: "published", external_post_id: "x123" })
    );
  });

  it("schedules on platform and marks job scheduled", async () => {
    const publish = vi.fn().mockResolvedValue({ external_post_id: "draft-1" });
    const save = vi.fn().mockResolvedValue(undefined);

    await processPublishJob(
      { post_id: "p1", holaboss_user_id: "u1", content: "hello", scheduled_at: "2026-03-15T14:00:00.000Z" },
      { publishToX: publish, saveJobState: save }
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ scheduled_at: "2026-03-15T14:00:00.000Z" })
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ status: "scheduled" })
    );
  });
});
