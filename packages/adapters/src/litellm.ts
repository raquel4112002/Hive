/** LiteLLM admin client. The master key stays on the server. */

export type LiteLLMConfig = { baseUrl: string; masterKey: string };

export type LiteLLMKey = { key: string; keyAlias: string };

export type LiteLLMSpendRow = { botId: string; spendUsd: number; tokens: number };

export function hiveLiteLLM(env: NodeJS.ProcessEnv = process.env): LiteLLMConfig | null {
  const baseUrl = env.HIVE_LITELLM_BASE_URL?.trim().replace(/\/$/, "");
  const masterKey = env.HIVE_LITELLM_MASTER_KEY?.trim();
  if (!baseUrl || !masterKey) return null;
  return { baseUrl, masterKey };
}

/** OpenAI-compatible base for a bot key. The admin URL is the proxy root. */
export function liteLLMModelBaseUrl(config: LiteLLMConfig): string {
  return config.baseUrl.endsWith("/v1") ? config.baseUrl : `${config.baseUrl}/v1`;
}

type FetchLike = typeof fetch;

type SpendMeta = { bot_id?: string; user_api_key_alias?: string };

type SpendLog = {
  spend?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  metadata?: SpendMeta;
};

function tokensOf(row: SpendLog): number {
  if (typeof row.total_tokens === "number" && Number.isFinite(row.total_tokens)) {
    return row.total_tokens;
  }
  return Number(row.prompt_tokens ?? 0) + Number(row.completion_tokens ?? 0);
}

/** The proxy keeps bot_id on the key, and copies the key alias onto each request log. */
function botIdFromSpend(metadata: SpendMeta | undefined): string | null {
  const direct = metadata?.bot_id?.trim();
  if (direct) return direct;
  const alias = metadata?.user_api_key_alias?.trim() ?? "";
  const prefix = "hive-";
  return alias.startsWith(prefix) ? alias.slice(prefix.length) : null;
}

export function createLiteLLM(config: LiteLLMConfig, fetchImpl: FetchLike = fetch) {
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.masterKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`LiteLLM ${path} failed (${response.status})`);
    if (response.status === 204) return null;
    return response.json() as Promise<unknown>;
  }

  return {
    async models(): Promise<string[]> {
      const body = (await call("/model/info")) as { data?: Array<{ model_name?: string }> };
      const names = (body.data ?? [])
        .map((row) => row.model_name?.trim() ?? "")
        .filter((name) => name.length > 0);
      return [...new Set(names)];
    },

    async generate(input: {
      model: string;
      budgetUsd: number | null;
      botId: string;
      orgId: string;
    }): Promise<LiteLLMKey> {
      const body = (await call("/key/generate", {
        method: "POST",
        body: JSON.stringify({
          models: [input.model],
          max_budget: input.budgetUsd,
          budget_duration: input.budgetUsd == null ? null : "30d",
          metadata: { bot_id: input.botId, org_id: input.orgId },
          key_alias: `hive-${input.botId}`,
        }),
      })) as { key?: string; token?: string; token_id?: string; key_alias?: string };
      const key = body.key?.trim();
      if (!key) throw new Error("LiteLLM /key/generate failed (no key)");
      return { key, keyAlias: body.key_alias?.trim() || body.token_id || `hive-${input.botId}` };
    },

    async update(input: { key: string; model: string; budgetUsd: number | null }): Promise<void> {
      await call("/key/update", {
        method: "POST",
        body: JSON.stringify({
          key: input.key,
          models: [input.model],
          max_budget: input.budgetUsd,
          budget_duration: input.budgetUsd == null ? null : "30d",
        }),
      });
    },

    async block(key: string): Promise<void> {
      await call("/key/block", { method: "POST", body: JSON.stringify({ key }) });
    },

    async unblock(key: string): Promise<void> {
      await call("/key/unblock", { method: "POST", body: JSON.stringify({ key }) });
    },

    async remove(key: string): Promise<void> {
      await call("/key/delete", { method: "POST", body: JSON.stringify({ keys: [key] }) });
    },

    async keyInfo(key: string): Promise<{ spendUsd: number; maxBudgetUsd: number | null }> {
      const body = (await call(`/key/info?key=${encodeURIComponent(key)}`)) as {
        info?: { spend?: number; max_budget?: number | null };
      };
      return {
        spendUsd: Number(body.info?.spend ?? 0),
        maxBudgetUsd: body.info?.max_budget == null ? null : Number(body.info.max_budget),
      };
    },

    async spendLogs(startDate: string, endDate: string): Promise<LiteLLMSpendRow[]> {
      const query = `start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&summarize=false`;
      const body = (await call(`/spend/logs?${query}`)) as
        | SpendLog[]
        | { data?: SpendLog[] };
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      const totals = new Map<string, { spendUsd: number; tokens: number }>();
      for (const row of rows) {
        const botId = botIdFromSpend(row.metadata);
        if (!botId) continue;
        const current = totals.get(botId) ?? { spendUsd: 0, tokens: 0 };
        current.spendUsd += Number(row.spend ?? 0);
        current.tokens += tokensOf(row);
        totals.set(botId, current);
      }
      return [...totals].map(([botId, total]) => ({ botId, ...total }));
    },
  };
}

export function rollupDepartmentSpend(
  bots: Array<{ departments: string[]; spendUsd: number; tokens: number }>,
): Array<{ name: string; spendUsd: number; tokens: number }> {
  const totals = new Map<string, { spendUsd: number; tokens: number }>();
  for (const bot of bots) {
    for (const name of bot.departments) {
      const current = totals.get(name) ?? { spendUsd: 0, tokens: 0 };
      current.spendUsd += bot.spendUsd;
      current.tokens += bot.tokens;
      totals.set(name, current);
    }
  }
  return [...totals].map(([name, total]) => ({ name, ...total }));
}
