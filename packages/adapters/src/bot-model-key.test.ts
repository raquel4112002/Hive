import { BUDGET_EXCEEDED_RUN_ERROR } from "@rakazo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBotRunKey } from "./bot-model-key.js";

const row = {
  botId: "bot-1",
  spaceId: "space-1",
  keyAlias: "hive-bot-1",
  ciphertext: "cipher",
  model: "ollama/qwen",
  budgetCents: 100,
  pasted: false,
};

function deps() {
  return {
    prisma: { botLiteLLMKey: { findUnique: async () => row } },
    secretStore: { load: async () => "sk-bot" },
    mcpAllowPrivateEndpoint: true,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HIVE_LITELLM_BASE_URL;
  delete process.env.HIVE_LITELLM_MASTER_KEY;
});

describe("loadBotRunKey", () => {
  it("fails the run when the monthly budget is spent", async () => {
    process.env.HIVE_LITELLM_BASE_URL = "http://litellm.test";
    process.env.HIVE_LITELLM_MASTER_KEY = "master-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ info: { spend: 2, max_budget: 1 } }),
      ),
    );
    await expect(loadBotRunKey(deps() as never, "bot-1")).rejects.toThrow(BUDGET_EXCEEDED_RUN_ERROR);
  });

  it("keeps the key when the proxy does not answer", async () => {
    process.env.HIVE_LITELLM_BASE_URL = "http://litellm.test";
    process.env.HIVE_LITELLM_MASTER_KEY = "master-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const loaded = await loadBotRunKey(deps() as never, "bot-1");
    expect(loaded?.apiKey).toBe("sk-bot");
    expect(loaded?.baseUrl).toBe("http://litellm.test/v1");
  });
});
