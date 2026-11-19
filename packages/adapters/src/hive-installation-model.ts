import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";

/** The installation model: one OpenAI-compatible endpoint, its key, and a model id. */
export type HiveInstallationModel = {
  provider: typeof OPENAI_COMPATIBLE_PROVIDER_ID;
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Reads the installation endpoint. All three values are required; nothing here
 * has a built-in address, key, or model. Point the same three at LiteLLM later.
 */
export function hiveInstallationModel(
  env: NodeJS.ProcessEnv = process.env,
): HiveInstallationModel | null {
  const baseUrl = env.HIVE_MODEL_BASE_URL?.trim();
  const apiKey = env.HIVE_MODEL_API_KEY?.trim();
  const model = env.HIVE_DEFAULT_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { provider: OPENAI_COMPATIBLE_PROVIDER_ID, baseUrl, apiKey, model };
}

/**
 * A bot may name its own model on the installation endpoint. A per-bot key is
 * accepted when one is supplied and is not generated here; otherwise the
 * installation key is the fallback.
 */
export function hiveRunModel(
  bot: { modelProvider?: string | null; modelId?: string | null },
  installation: HiveInstallationModel,
  botApiKey?: string | null,
): HiveInstallationModel {
  const own =
    bot.modelProvider?.trim() === installation.provider && bot.modelId?.trim()
      ? bot.modelId.trim()
      : installation.model;
  return {
    ...installation,
    model: own,
    apiKey: botApiKey?.trim() || installation.apiKey,
  };
}
