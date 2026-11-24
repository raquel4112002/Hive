import type { AdapterContext, SecretStore } from "@rakazo/adapter-kit";
import { redactSecrets, VAULT_SEALED_MESSAGE } from "@rakazo/core";
import {
  hiveCredentialRefs,
  recordHiveCredentialUse,
  runAsSystem,
  saveHiveCredentialRef,
  type HiveCredentialKind,
  type PrismaClient,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { OPENBAO_REF_PREFIX, openBaoOptionsFromEnv } from "./openbao-secret-store.js";

async function openBaoSealed(
  source: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if ((source.SECRET_STORE?.trim() || "encrypted") !== "openbao") return false;
  const { address } = openBaoOptionsFromEnv(source);
  const response = await fetchImpl(`${address}/v1/sys/seal-status`, {
    signal: AbortSignal.timeout(1000),
  });
  const body = (await response.json()) as { sealed?: boolean };
  return body.sealed === true;
}

/** The health text when the vault is sealed, or null when it is open or unused. */
export async function vaultHealth(
  source: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    return (await openBaoSealed(source, fetchImpl)) ? VAULT_SEALED_MESSAGE : null;
  } catch {
    return null;
  }
}

async function botUsesVault(prisma: PrismaClient, botId: string): Promise<boolean> {
  const credentials = await hiveCredentialRefs(prisma, botId);
  if (credentials.some((row) => row.secretRef.startsWith(OPENBAO_REF_PREFIX))) return true;
  const key = prisma.botLiteLLMKey?.findUnique;
  if (typeof key === "function") {
    const row = await runAsSystem("vault model key", () =>
      prisma.botLiteLLMKey.findUnique({ where: { botId }, select: { ciphertext: true } }),
    );
    if (row?.ciphertext.startsWith(OPENBAO_REF_PREFIX)) return true;
  }
  const secrets = prisma.botSecret?.findMany;
  if (typeof secrets !== "function") return false;
  const rows = await runAsSystem("vault bot secrets", () =>
    prisma.botSecret.findMany({ where: { botId }, select: { ciphertext: true } }),
  );
  return rows.some((row) => row.ciphertext.startsWith(OPENBAO_REF_PREFIX));
}

/** Fails a run that would read the vault while it is sealed. Other runs continue. */
export async function sealedVaultRunError(
  prisma: PrismaClient,
  botId: string,
  source: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!(await vaultHealth(source, fetchImpl))) return null;
  return (await botUsesVault(prisma, botId)) ? VAULT_SEALED_MESSAGE : null;
}

export function hiveCredentialPath(orgId: string, botId: string, label: string): string {
  const name = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "value";
  return `org/${orgId}/bot/${botId}/${name}`;
}

export function hiveCredentialVariable(kind: string, label: string): string {
  const cleaned = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "VALUE";
  return `HIVE_${kind.toUpperCase()}_${cleaned}`;
}

export function maskCredentialText(text: string, secrets: readonly string[]): string {
  return redactSecrets(text, secrets);
}

function vaultContext(orgId: string, actorUserId: string): AdapterContext {
  return {
    operationId: "hive-credential",
    traceId: "hive-credential",
    userId: actorUserId,
    spaceId: orgId,
    signal: new AbortController().signal,
  };
}

export async function loadHiveCredentialValues(
  prisma: PrismaClient,
  secretStore: Pick<SecretStore, "load"> | undefined,
  botId: string,
  options: { record?: boolean } = {},
): Promise<{ values: string[]; env: Record<string, string> }> {
  if (!secretStore) return { values: [], env: {} };
  const rows = await hiveCredentialRefs(prisma, botId);
  const values: string[] = [];
  const env: Record<string, string> = {};
  for (const row of rows) {
    try {
      const value = await secretStore.load(row.secretRef, `bot:${botId}`);
      if (!value) continue;
      values.push(value);
      env[hiveCredentialVariable(row.kind, row.label)] = value;
      if (options.record) {
        await recordHiveCredentialUse(prisma, {
          organizationId: row.organizationId,
          botId,
          credentialId: row.id,
        });
      }
    } catch {
      getLogger().warn("Bot credential could not be read");
    }
  }
  return { values, env };
}

export async function writeHiveCredential(
  prisma: PrismaClient,
  secretStore: SecretStore,
  input: {
    organizationId: string;
    botId: string;
    kind: HiveCredentialKind;
    label: string;
    value: string;
    actorUserId: string;
  },
) {
  const path = hiveCredentialPath(input.organizationId, input.botId, input.label);
  const stored = await secretStore.put(input.value, vaultContext(input.organizationId, input.actorUserId), {
    recordId: path,
  });
  const check = await secretStore.load(stored.ciphertext, `bot:${input.botId}`);
  if (check !== input.value) throw new Error("Credential was not saved");
  return saveHiveCredentialRef(prisma, {
    organizationId: input.organizationId,
    botId: input.botId,
    kind: input.kind,
    label: input.label,
    secretRef: stored.ciphertext,
    actorUserId: input.actorUserId,
  });
}

export async function revokeBotVault(
  store: { revokeBot?: (botId: string) => Promise<void> } | undefined,
  botId: string,
): Promise<void> {
  await store?.revokeBot?.(botId);
}

/** Copy bot secrets and model keys into the vault, and keep the old copy until the new one reads back. */
export async function migrateHiveVault(prisma: PrismaClient, store: SecretStore): Promise<void> {
  if (store.describe().id !== "openbao") return;
  await migrateModelKeys(prisma, store);
  await migrateBotSecrets(prisma, store);
}

async function migrateModelKeys(prisma: PrismaClient, store: SecretStore): Promise<void> {
  const rows = await runAsSystem("migrate model keys", () =>
    prisma.botLiteLLMKey.findMany({
      select: { botId: true, spaceId: true, ciphertext: true },
    }),
  );
  for (const row of rows) {
    if (row.ciphertext.startsWith(OPENBAO_REF_PREFIX)) continue;
    const space = await runAsSystem("migrate model key space", () =>
      prisma.space.findUnique({
        where: { id: row.spaceId },
        select: { organizationId: true },
      }),
    );
    if (!space) continue;
    await copyCredential(prisma, store, {
      botId: row.botId,
      orgId: space.organizationId,
      label: "litellm",
      ciphertext: row.ciphertext,
      context: `bot-model-${row.botId}`,
      save: (secretRef) =>
        runAsSystem("migrate model key ref", () =>
          prisma.botLiteLLMKey.updateMany({
            where: { botId: row.botId, ciphertext: row.ciphertext },
            data: { ciphertext: secretRef },
          }),
        ),
    });
  }
}

async function migrateBotSecrets(prisma: PrismaClient, store: SecretStore): Promise<void> {
  const rows = await runAsSystem("migrate bot secrets", () =>
    prisma.botSecret.findMany({
      select: { id: true, botId: true, spaceId: true, name: true, ciphertext: true },
    }),
  );
  for (const row of rows) {
    if (row.ciphertext.startsWith(OPENBAO_REF_PREFIX)) continue;
    const space = await runAsSystem("migrate bot secret space", () =>
      prisma.space.findUnique({
        where: { id: row.spaceId },
        select: { organizationId: true },
      }),
    );
    if (!space) continue;
    await copyCredential(prisma, store, {
      botId: row.botId,
      orgId: space.organizationId,
      label: row.name,
      ciphertext: row.ciphertext,
      context: row.id,
      save: (secretRef) =>
        runAsSystem("migrate bot secret ref", () =>
          prisma.botSecret.updateMany({
            where: { id: row.id, ciphertext: row.ciphertext },
            data: { ciphertext: secretRef },
          }),
        ),
    });
  }
}

async function copyCredential(
  _prisma: PrismaClient,
  store: SecretStore,
  input: {
    botId: string;
    orgId: string;
    label: string;
    ciphertext: string;
    context: string;
    save: (secretRef: string) => Promise<unknown>;
  },
): Promise<void> {
  try {
    const value = await store.load(input.ciphertext, input.context);
    const stored = await store.put(value, vaultContext(input.orgId, "hive-migrate"), {
      recordId: hiveCredentialPath(input.orgId, input.botId, input.label),
    });
    const check = await store.load(stored.ciphertext, `bot:${input.botId}`);
    if (check !== value) return;
    await input.save(stored.ciphertext);
  } catch {
    getLogger().warn("Bot credential stayed in the previous store");
  }
}
