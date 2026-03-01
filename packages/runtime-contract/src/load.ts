import { readFile } from "node:fs/promises";

import YAML from "yaml";

import { RuntimeContract, runtimeContractSchema } from "./schema";

export async function loadRuntimeContract(path: string): Promise<RuntimeContract> {
  const raw = await readFile(path, "utf-8");
  const parsed = YAML.parse(raw);
  return runtimeContractSchema.parse(parsed);
}
