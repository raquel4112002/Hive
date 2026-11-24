import type { SecretStore } from "@rakazo/adapter-kit";
import { BUDGET_EXCEEDED_RUN_ERROR } from "@rakazo/core";
import {
  deleteBotModelKey,
  readBotModelKey,
  runAsSystem,
  saveBotModelKey,
  type PrismaClient,
} from "@rakazo/db";
import { rollupDepartmentSpend } from "./litellm.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { createLiteLLM, hiveLiteLLM, liteLLMModelBaseUrl } from "./litellm.js";

type KeyDeps = Pick<ExecutorDeps, "prisma" | "secretStore" | "mcpAllowPrivateEndpoint">;

function dollars(cents: number | null): number | null {
  return cents == null ? null : cents / 100;
}

function cents(usd: number | null | undefined): number | null {
  if (usd == null) return null;
  return Math.round(usd * 100);
}

async function seal(
  secretStore: SecretStore,
  botId: string,
  orgId: string,
  apiKey: string,
): Promise<string> {
  const stored = await secretStore.put(
    apiKey,
    {
      operationId: botId,
      traceId: botId,
      userId: "hive-bot-key",
      spaceId: orgId,
      signal: new AbortController().signal,
    },
    { recordId: `org/${orgId}/bot/${botId}/litellm` },
  );
  return stored.ciphertext;
}

async function open(secretStore: SecretStore, botId: string, ciphertext: string): Promise<string> {
  return secretStore.load(ciphertext, `bot-model-${botId}`);
}

export async function peekBotModel(
  prisma: PrismaClient,
  botId: string,
): Promise<{ model: string; baseUrl: string } | null> {
  const litellm = hiveLiteLLM();
  if (!litellm) return null;
  const row = await readBotModelKey(prisma, botId);
  if (!row) return null;
  return { model: row.model, baseUrl: liteLLMModelBaseUrl(litellm) };
}

/** The key a run should send. Throws when the monthly budget is already spent. */
export async function loadBotRunKey(
  deps: KeyDeps,
  botId: string,
): Promise<{ apiKey: string; baseUrl: string; model: string; allowPrivate: boolean } | null> {
  const litellm = hiveLiteLLM();
  if (!litellm) return null;
  const row = await readBotModelKey(deps.prisma, botId);
  if (!row || typeof deps.secretStore?.load !== "function") return null;
  const baseUrl = liteLLMModelBaseUrl(litellm);
  const apiKey = await open(deps.secretStore, botId, row.ciphertext);
  if (litellm && row.budgetCents != null) {
    try {
      const info = await createLiteLLM(litellm).keyInfo(apiKey);
      const limit = info.maxBudgetUsd ?? row.budgetCents / 100;
      if (info.spendUsd >= limit) throw new Error(BUDGET_EXCEEDED_RUN_ERROR);
    } catch (error) {
      if (error instanceof Error && error.message === BUDGET_EXCEEDED_RUN_ERROR) throw error;
    }
  }
  return {
    apiKey,
    baseUrl,
    model: row.model,
    allowPrivate: deps.mcpAllowPrivateEndpoint === true,
  };
}

export async function issueBotModelKey(
  deps: KeyDeps,
  input: {
    botId: string;
    spaceId: string;
    orgId: string;
    model: string;
    monthlyBudget?: number | null;
    modelKey?: string | null;
  },
): Promise<void> {
  const litellm = hiveLiteLLM();
  if (!litellm) throw new Error("LiteLLM is not configured.");
  const model = input.model.trim();
  if (!model) throw new Error("Choose a model.");
  const pasted = input.modelKey?.trim() || "";
  const budget = cents(input.monthlyBudget);
  const existing = await readBotModelKey(deps.prisma, input.botId);
  let apiKey = pasted;
  let keyAlias = "pasted";
  if (existing && pasted === "") {
    const current = await open(deps.secretStore, input.botId, existing.ciphertext);
    await createLiteLLM(litellm).update({
      key: current,
      model,
      budgetUsd: dollars(budget),
    });
    apiKey = current;
    keyAlias = existing.keyAlias;
  } else if (!pasted) {
    const issued = await createLiteLLM(litellm).generate({
      model,
      budgetUsd: dollars(budget),
      botId: input.botId,
      orgId: input.orgId,
    });
    apiKey = issued.key;
    keyAlias = issued.keyAlias;
  }
  try {
    const ciphertext = await seal(deps.secretStore, input.botId, input.orgId, apiKey);
    await saveBotModelKey(deps.prisma, {
      botId: input.botId,
      spaceId: input.spaceId,
      keyAlias,
      ciphertext,
      model,
      budgetCents: budget,
      pasted: pasted.length > 0 || existing?.pasted === true,
    });
  } catch (error) {
    if (litellm && keyAlias !== "pasted" && keyAlias !== existing?.keyAlias) {
      await createLiteLLM(litellm)
        .remove(apiKey)
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function revokeBotModelKey(
  deps: KeyDeps,
  botId: string,
  mode: "block" | "delete",
): Promise<void> {
  const row = await readBotModelKey(deps.prisma, botId);
  if (!row) return;
  const litellm = hiveLiteLLM();
  if (litellm && typeof deps.secretStore?.load === "function") {
    const apiKey = await open(deps.secretStore, botId, row.ciphertext);
    const client = createLiteLLM(litellm);
    if (mode === "delete") await client.remove(apiKey);
    else await client.block(apiKey);
  }
  if (mode === "delete") await deleteBotModelKey(deps.prisma, botId);
}

export async function listBotSpend(deps: KeyDeps, spaceId: string, month: string) {
  const litellm = hiveLiteLLM();
  if (!litellm || !/^\d{4}-\d{2}$/.test(month)) return { bots: [], departments: [] };
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const mon = Number(monthText);
  const endMonth = mon === 12 ? 1 : mon + 1;
  const endYear = mon === 12 ? year + 1 : year;
  const logs = await createLiteLLM(litellm).spendLogs(
    `${month}-01`,
    `${endYear}-${String(endMonth).padStart(2, "0")}-01`,
  );
  const spend = new Map(logs.map((row) => [row.botId, row]));
  const bots = await runAsSystem("hive bot spend", async () => {
    const rows = await deps.prisma.bot.findMany({
      where: { spaceId, litellmKey: { isNot: null } },
      select: { id: true, name: true },
    });
    const links = await deps.prisma.botDepartmentAssignment.findMany({
      where: { botId: { in: rows.map((row) => row.id) } },
      select: { botId: true, departmentId: true },
    });
    const departments = await deps.prisma.department.findMany({
      where: { id: { in: links.map((link) => link.departmentId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(departments.map((department) => [department.id, department.name]));
    return rows.map((row) => ({
      botId: row.id,
      name: row.name,
      departments: links
        .filter((link) => link.botId === row.id)
        .map((link) => nameById.get(link.departmentId))
        .filter((name): name is string => Boolean(name)),
      spendUsd: spend.get(row.id)?.spendUsd ?? 0,
      tokens: spend.get(row.id)?.tokens ?? 0,
    }));
  });
  return { bots, departments: rollupDepartmentSpend(bots) };
}

export async function unblockBotModelKey(deps: KeyDeps, botId: string): Promise<void> {
  const row = await readBotModelKey(deps.prisma, botId);
  const litellm = hiveLiteLLM();
  if (!row || !litellm || typeof deps.secretStore?.load !== "function") return;
  const apiKey = await open(deps.secretStore, botId, row.ciphertext);
  await createLiteLLM(litellm).unblock(apiKey);
}
