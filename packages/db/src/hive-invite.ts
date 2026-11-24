// Hive modification: closed signup and one-time invitations.
// Derived from Rakazo (Apache License 2.0).

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { joinEveryone } from "./hive.js";
import { runAsSystem } from "./row-security.js";
import { IsolationError } from "./scope.js";

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;

export function hiveAllowPublicSignup(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HIVE_ALLOW_SIGNUP === "true";
}

/** Public signup stays open only for the first organization, unless the flag is set. */
export async function hivePublicSignupClosed(prisma: PrismaClient): Promise<boolean> {
  if (hiveAllowPublicSignup()) return false;
  const count = prisma.organization?.count;
  if (typeof count !== "function") return false;
  return (await prisma.organization.count()) > 0;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

type InviteRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  departmentIds: string;
  expiresAt: Date;
  usedAt: Date | null;
};

function usable(row: InviteRow | null, email: string): row is InviteRow {
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return false;
  return row.email === email.trim().toLowerCase();
}

export async function peekHiveInvite(
  prisma: PrismaClient,
  token: string,
  email: string,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed || typeof prisma.hiveInvite?.findUnique !== "function") return false;
  const row = await runAsSystem("peek hive invite", () =>
    prisma.hiveInvite.findUnique({ where: { tokenHash: hashToken(trimmed) } }),
  );
  return usable(row, email);
}

export async function createHiveInvite(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    createdByUserId: string;
    email: string;
    role: "ADMIN" | "USER";
    departmentIds: string[];
    webOrigin: string;
  },
): Promise<{ link: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  const departmentIds = [...new Set(input.departmentIds.map((id) => id.trim()).filter(Boolean))];
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_MS);
  await runAsSystem("create hive invite", async () => {
    if (departmentIds.length > 0) {
      const found = await prisma.department.findMany({
        where: { id: { in: departmentIds }, organizationId: input.organizationId },
        select: { id: true },
      });
      if (found.length !== departmentIds.length) throw new IsolationError();
    }
    await prisma.hiveInvite.create({
      data: {
        organizationId: input.organizationId,
        email,
        role: input.role === "ADMIN" ? "ADMIN" : "USER",
        tokenHash: hashToken(token),
        departmentIds: departmentIds.join(","),
        expiresAt,
        createdByUserId: input.createdByUserId,
      },
    });
  });
  const origin = input.webOrigin.replace(/\/$/, "");
  return { link: `${origin}/sign-up?invite=${token}`, expiresAt };
}

/** The invited person joins the existing organization. They do not found a new one. */
export async function acceptHiveInvite(
  prisma: PrismaClient,
  user: { id: string; email: string },
  token: string,
): Promise<{ spaceId: string }> {
  const email = user.email.trim().toLowerCase();
  const spaceId = await runAsSystem("accept hive invite", async () => {
    const invite = await prisma.hiveInvite.findUnique({
      where: { tokenHash: hashToken(token.trim()) },
    });
    if (!usable(invite, email)) throw new IsolationError();
    const claimed = await prisma.hiveInvite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new IsolationError();
    const organizationId = invite.organizationId;
    await prisma.member
      .create({
        data: {
          id: newId(),
          organizationId,
          userId: user.id,
          role: "member",
          createdAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
    // Inserting the organization member also creates the default space membership.
    await prisma.spaceMember
      .create({
        data: {
          id: newId(),
          spaceId: organizationId,
          organizationId,
          userId: user.id,
          role: "member",
          createdAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
    await prisma.hiveRole.create({
      data: {
        organizationId,
        userId: user.id,
        role: invite.role === "ADMIN" ? "ADMIN" : "USER",
      },
    });
    const departmentIds = invite.departmentIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    for (const departmentId of departmentIds) {
      await prisma.departmentMember.create({ data: { departmentId, userId: user.id } });
    }
    await prisma.notificationPreference
      .create({ data: { spaceId: organizationId, userId: user.id } })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
    return organizationId;
  });
  await joinEveryone(prisma, spaceId, user.id);
  return { spaceId };
}
