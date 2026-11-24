// Hive modification: metadata for bot credentials. The value is never stored here.
// Derived from Rakazo (Apache License 2.0).

import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

export type HiveCredentialKind = "email" | "login" | "api_key";

export interface HiveCredentialView {
  id: string;
  kind: HiveCredentialKind;
  label: string;
  set: true;
  updatedAt: string;
}

function view(row: {
  id: string;
  kind: string;
  label: string;
  updatedAt: Date;
}): HiveCredentialView {
  return {
    id: row.id,
    kind: row.kind === "login" || row.kind === "api_key" ? row.kind : "email",
    label: row.label,
    set: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listHiveCredentials(
  prisma: PrismaClient,
  botId: string,
): Promise<HiveCredentialView[]> {
  const rows = await runAsSystem("list hive credentials", () =>
    prisma.hiveBotCredential.findMany({
      where: { botId },
      orderBy: { label: "asc" },
      select: { id: true, kind: true, label: true, updatedAt: true },
    }),
  );
  return rows.map(view);
}

export async function saveHiveCredentialRef(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    botId: string;
    kind: HiveCredentialKind;
    label: string;
    secretRef: string;
    actorUserId: string;
  },
): Promise<HiveCredentialView> {
  return runAsSystem("save hive credential", async () => {
    const existing = await prisma.hiveBotCredential.findUnique({
      where: { botId_label: { botId: input.botId, label: input.label } },
    });
    const row = existing
      ? await prisma.hiveBotCredential.update({
          where: { id: existing.id },
          data: {
            kind: input.kind,
            secretRef: input.secretRef,
            updatedByUserId: input.actorUserId,
          },
        })
      : await prisma.hiveBotCredential.create({
          data: {
            organizationId: input.organizationId,
            botId: input.botId,
            kind: input.kind,
            label: input.label,
            secretRef: input.secretRef,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
          },
        });
    await prisma.hiveCredentialEvent.create({
      data: {
        organizationId: input.organizationId,
        botId: input.botId,
        credentialId: row.id,
        action: existing ? "updated" : "created",
        actorUserId: input.actorUserId,
      },
    });
    return view(row);
  });
}

export async function removeHiveCredential(
  prisma: PrismaClient,
  input: { botId: string; label: string; actorUserId: string; organizationId: string },
): Promise<string | null> {
  return runAsSystem("remove hive credential", async () => {
    const existing = await prisma.hiveBotCredential.findUnique({
      where: { botId_label: { botId: input.botId, label: input.label } },
    });
    if (!existing) return null;
    await prisma.hiveBotCredential.delete({ where: { id: existing.id } });
    await prisma.hiveCredentialEvent.create({
      data: {
        organizationId: input.organizationId,
        botId: input.botId,
        credentialId: existing.id,
        action: "deleted",
        actorUserId: input.actorUserId,
      },
    });
    return existing.secretRef;
  });
}

export async function recordHiveCredentialUse(
  prisma: PrismaClient,
  input: { organizationId: string; botId: string; credentialId: string },
): Promise<void> {
  await runAsSystem("hive credential use", () =>
    prisma.hiveCredentialEvent.create({
      data: {
        organizationId: input.organizationId,
        botId: input.botId,
        credentialId: input.credentialId,
        action: "used",
      },
    }),
  );
}

export async function hiveCredentialRefs(
  prisma: PrismaClient,
  botId: string,
): Promise<Array<{ id: string; organizationId: string; label: string; kind: string; secretRef: string }>> {
  const findMany = prisma.hiveBotCredential?.findMany;
  if (typeof findMany !== "function") return [];
  return runAsSystem("hive credential refs", () =>
    prisma.hiveBotCredential.findMany({
      where: { botId },
      select: { id: true, organizationId: true, label: true, kind: true, secretRef: true },
    }),
  );
}
