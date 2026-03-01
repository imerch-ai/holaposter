import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("repo bootstrap", () => {
  it("has workspace root package name", async () => {
    const packagePath = resolve(process.cwd(), "../../package.json");
    const raw = await readFile(packagePath, "utf-8");
    const pkg = JSON.parse(raw) as { name?: string };
    expect(pkg.name).toBe("postsyncer-app");
  });
});
