import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server";

describe("CORS", () => {
  it("allows web origin to call posts API", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/posts",
      headers: {
        origin: "http://localhost:3000"
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    await app.close();
  });
});
