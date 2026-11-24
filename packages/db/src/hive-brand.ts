// Hive modification: brand metadata. The files live in object storage.
// Derived from Rakazo (Apache License 2.0).

import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

export interface HiveBrandRecord {
  organizationId: string;
  productName: string;
  logoLightKey: string | null;
  logoDarkKey: string | null;
  faviconKey: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  loginText: string | null;
}

export async function readHiveBrand(
  prisma: PrismaClient,
  organizationId: string,
): Promise<HiveBrandRecord | null> {
  return runAsSystem("read hive brand", () =>
    prisma.hiveBrand.findUnique({
      where: { organizationId },
      select: {
        organizationId: true,
        productName: true,
        logoLightKey: true,
        logoDarkKey: true,
        faviconKey: true,
        primaryColor: true,
        accentColor: true,
        loginText: true,
      },
    }),
  );
}

export async function saveHiveBrand(
  prisma: PrismaClient,
  input: HiveBrandRecord,
): Promise<void> {
  await runAsSystem("save hive brand", () =>
    prisma.hiveBrand.upsert({
      where: { organizationId: input.organizationId },
      create: { ...input, updatedAt: new Date() },
      update: {
        productName: input.productName,
        logoLightKey: input.logoLightKey,
        logoDarkKey: input.logoDarkKey,
        faviconKey: input.faviconKey,
        primaryColor: input.primaryColor,
        accentColor: input.accentColor,
        loginText: input.loginText,
        updatedAt: new Date(),
      },
    }),
  );
}

export async function readHiveBotAvatars(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Array<{ botId: string; objectKey: string }>> {
  return runAsSystem("read hive bot avatars", () =>
    prisma.hiveBotAvatar.findMany({
      where: { organizationId },
      select: { botId: true, objectKey: true },
    }),
  );
}

export async function saveHiveBotAvatar(
  prisma: PrismaClient,
  input: { botId: string; organizationId: string; objectKey: string },
): Promise<void> {
  await runAsSystem("save hive bot avatar", () =>
    prisma.hiveBotAvatar.upsert({
      where: { botId: input.botId },
      create: { ...input, updatedAt: new Date() },
      update: { objectKey: input.objectKey, organizationId: input.organizationId, updatedAt: new Date() },
    }),
  );
}

export async function hiveInviteOrganization(
  prisma: PrismaClient,
  token: string,
): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(trimmed).digest("hex");
  const row = await runAsSystem("hive invite brand", () =>
    prisma.hiveInvite.findUnique({ where: { tokenHash }, select: { organizationId: true, usedAt: true, expiresAt: true } }),
  );
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  return row.organizationId;
}
