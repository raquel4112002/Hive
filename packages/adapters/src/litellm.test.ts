import { describe, expect, it, vi } from "vitest";
import { createLiteLLM, hiveLiteLLM, rollupDepartmentSpend } from "./litellm.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("hiveLiteLLM", () => {
  it("reads both values and ignores a partial pair", () => {
    expect(hiveLiteLLM({})).toBeNull();
    expect(hiveLiteLLM({ HIVE_LITELLM_BASE_URL: "http://litellm.test" })).toBeNull();
    expect(
      hiveLiteLLM({
        HIVE_LITELLM_BASE_URL: "http://litellm.test/",
        HIVE_LITELLM_MASTER_KEY: "master",
      }),
    ).toEqual({ baseUrl: "http://litellm.test", masterKey: "master" });
  });
});

describe("createLiteLLM", () => {
  it("lists models, generates a key, and sums spend by bot", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url).startsWith("http://litellm.test")).toBe(true);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer master");
      if (String(url).endsWith("/model/info")) {
        return json({ data: [{ model_name: "ollama/qwen" }, { model_name: "ollama/qwen" }] });
      }
      if (String(url).endsWith("/key/generate")) {
        const body = JSON.parse(String(init?.body));
        expect(body.models).toEqual(["ollama/qwen"]);
        expect(body.max_budget).toBe(12);
        expect(body.metadata).toEqual({ bot_id: "bot-1", org_id: "org-1" });
        return json({ key: "sk-bot", key_alias: "hive-bot-1" });
      }
      if (String(url).includes("/spend/logs")) {
        return json({
          data: [
            { spend: 1.5, metadata: { bot_id: "bot-1" } },
            { spend: 0.5, metadata: { bot_id: "bot-1" } },
            { spend: 3, metadata: {} },
          ],
        });
      }
      return json({});
    });
    const client = createLiteLLM(
      { baseUrl: "http://litellm.test", masterKey: "master" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.models()).toEqual(["ollama/qwen"]);
    expect(
      await client.generate({ model: "ollama/qwen", budgetUsd: 12, botId: "bot-1", orgId: "org-1" }),
    ).toEqual({ key: "sk-bot", keyAlias: "hive-bot-1" });
    expect(await client.spendLogs("2026-11-01", "2026-11-30")).toEqual([
      { botId: "bot-1", spendUsd: 2 },
    ]);
    const listed = createLiteLLM(
      { baseUrl: "http://litellm.test", masterKey: "master" },
      (async () => json([{ spend: 1, metadata: { bot_id: "bot-2" } }])) as unknown as typeof fetch,
    );
    expect(await listed.spendLogs("2026-11-01", "2026-12-01")).toEqual([
      { botId: "bot-2", spendUsd: 1 },
    ]);
  });

  it("updates, blocks, and deletes a key without echoing it", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push(`${init?.method} ${url} ${init?.body ?? ""}`);
      return json({});
    });
    const client = createLiteLLM(
      { baseUrl: "http://litellm.test", masterKey: "master-secret" },
      fetchImpl as unknown as typeof fetch,
    );
    await client.update({ key: "sk-bot", model: "ollama/qwen", budgetUsd: 4 });
    await client.block("sk-bot");
    await client.remove("sk-bot");
    expect(bodies.join("\n")).toContain("/key/update");
    expect(bodies.join("\n")).toContain("/key/block");
    expect(bodies.join("\n")).toContain("/key/delete");
    expect(bodies.join("\n")).not.toContain("master-secret");
  });

  it("does not put the master key in a failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const client = createLiteLLM(
      { baseUrl: "http://litellm.test", masterKey: "master-secret" },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.models()).rejects.toThrow("LiteLLM /model/info failed (401)");
  });
});

describe("rollupDepartmentSpend", () => {
  it("adds a bot's spend to each department it belongs to", () => {
    expect(
      rollupDepartmentSpend([
        { departments: ["Desk", "Todos"], spendUsd: 2 },
        { departments: ["Desk"], spendUsd: 1 },
      ]),
    ).toEqual([
      { name: "Desk", spendUsd: 3 },
      { name: "Todos", spendUsd: 2 },
    ]);
  });
});
