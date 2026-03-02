import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadRuntimeContract } from "../src/load";

describe("runtime contract", () => {
  it("loads and validates app.runtime.yaml", async () => {
    const contractPath = resolve(process.cwd(), "../../app.runtime.yaml");
    const contract = await loadRuntimeContract(contractPath);
    expect(contract.integration.destination).toBe("x");
    expect(contract.integration.credential_source).toBe("platform");
    expect(contract.env_contract).toContain("CORS_ALLOWED_ORIGINS");
    expect(contract.env_contract).toContain("VITE_API_BASE_URL");
  });

  it("loads mcp config when present", async () => {
    const contractPath = resolve(process.cwd(), "../../app.runtime.yaml");
    const contract = await loadRuntimeContract(contractPath);
    expect(contract.mcp?.enabled).toBe(true);
    expect(contract.mcp?.port).toBe(3099);
  });
});
