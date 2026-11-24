// Hive modification: SSO placement, password lock, and removal.
// Derived from Rakazo (Apache License 2.0).

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { joinEveryone } from "./hive.js";
import { runAsSystem } from "./row-security.js";
import { IsolationError } from "./scope.js";

export interface HiveGroupRule {
  group: string;
  role: "ADMIN" | "USER";
  department: string;
}

export function parseHiveGroupMap(text: string): HiveGroupRule[] {
  const rules: HiveGroupRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split <= 0) continue;
    const group = trimmed.slice(0, split).trim();
    const rest = trimmed.slice(split + 1).trim();
    const colon = rest.indexOf(":");
    const role = (colon === -1 ? rest : rest.slice(0, colon)).trim().toUpperCase();
    const department = colon === -1 ? "" : rest.slice(colon + 1).trim();
    if (!group || (role !== "ADMIN" && role !== "USER")) continue;
    rules.push({ group, role, department });
  }
  return rules;
}

export function hiveSsoPlacement(input: {
  existingRole: "SUPER_ADMIN" | "ADMIN" | "USER" | null;
  groups: string[];
  rules: HiveGroupRule[];
}): { role: "SUPER_ADMIN" | "ADMIN" | "USER"; departments: string[] } {
  const matched = input.rules.filter((rule) => input.groups.includes(rule.group));
  const role =
    input.existingRole === "SUPER_ADMIN"
      ? "SUPER_ADMIN"
      : matched.some((rule) => rule.role === "ADMIN")
        ? "ADMIN"
        : (input.existingRole ?? "USER");
  const departments = [
    ...(input.existingRole ? [] : ["Todos"]),
    ...matched.map((rule) => rule.department).filter(Boolean),
  ];
  return { role, departments: [...new Set(departments)] };
}

export function hivePasswordAllowed(role: string | null, passwordLogin: boolean): boolean {
  return passwordLogin || role === "SUPER_ADMIN";
}

export function hiveSsoRevokedUserIds(
  stored: Array<{ subject: string; userId: string }>,
  present: string[],
): string[] {
  const live = new Set(present);
  return [...new Set(stored.filter((row) => !live.has(row.subject)).map((row) => row.userId))];
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

export async function joinHiveSsoUser(
  prisma: PrismaClient,
  user: { id: string; email: string; emailVerified: boolean },
  groups: string[] = [],
  subject = "",
): Promise<{ organizationId: string; role: string }> {
  if (!user.emailVerified) throw new IsolationError();
  const placed = await runAsSystem("join hive sso", async () => {
    const enabled =
      typeof prisma.hiveSso?.findMany === "function"
        ? await prisma.hiveSso.findMany({
            where: { enabled: true },
            select: { organizationId: true, groupMap: true },
            take: 2,
          })
        : [];
    const row = enabled.length === 1 ? enabled[0] : null;
    const organizations = row
      ? []
      : await prisma.organization.findMany({ select: { id: true }, take: 2 });
    const organizationId = row?.organizationId ?? (organizations.length === 1 ? organizations[0]?.id : null);
    if (!organizationId) throw new IsolationError();
    const existing = await prisma.hiveRole.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      select: { role: true },
    });
    const placement = hiveSsoPlacement({
      existingRole:
        existing?.role === "SUPER_ADMIN" || existing?.role === "ADMIN" || existing?.role === "USER"
          ? existing.role
          : null,
      groups,
      rules: parseHiveGroupMap(row?.groupMap ?? ""),
    });
    if (!existing) {
      await prisma.member.create({
        data: {
          id: newId(),
          organizationId,
          userId: user.id,
          role: "member",
          createdAt: new Date(),
        },
      });
      await prisma.spaceMember.upsert({
        where: { spaceId_userId: { spaceId: organizationId, userId: user.id } },
        create: {
          id: newId(),
          spaceId: organizationId,
          organizationId,
          userId: user.id,
          role: "member",
          createdAt: new Date(),
        },
        update: {},
      });
      await prisma.hiveRole.create({
        data: { organizationId, userId: user.id, role: placement.role },
      });
      await prisma.notificationPreference.create({
        data: { spaceId: organizationId, userId: user.id },
      });
    } else if (existing.role !== placement.role) {
      await prisma.hiveRole.update({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        data: { role: placement.role },
      });
    }
    if (subject && typeof prisma.hiveSsoSubject?.upsert === "function") {
      await prisma.hiveSsoSubject.upsert({
        where: { organizationId_subject: { organizationId, subject } },
        create: { organizationId, userId: user.id, subject },
        update: { userId: user.id, removedAt: null },
      });
    }
    return { organizationId, role: placement.role, departments: placement.departments };
  });
  await joinEveryone(prisma, placed.organizationId, user.id);
  for (const name of placed.departments) {
    if (name === "Todos") continue;
    const department = await runAsSystem("hive sso department", async () => {
      const found = await prisma.department.findFirst({
        where: { organizationId: placed.organizationId, name },
        select: { id: true },
      });
      if (found) return found;
      return prisma.department.create({
        data: {
          organizationId: placed.organizationId,
          name,
          system: false,
          createdByUserId: user.id,
        },
        select: { id: true },
      });
    });
    await runAsSystem("hive sso department member", () =>
      prisma.departmentMember.upsert({
        where: { departmentId_userId: { departmentId: department.id, userId: user.id } },
        create: { departmentId: department.id, userId: user.id },
        update: {},
      }),
    );
  }
  return { organizationId: placed.organizationId, role: placed.role };
}

export async function hivePasswordBlocked(prisma: PrismaClient, userId: string): Promise<boolean> {
  if (typeof prisma.hiveRole?.findFirst !== "function" || typeof prisma.hiveSso?.findFirst !== "function") {
    return false;
  }
  const role = await runAsSystem("hive password role", () =>
    prisma.hiveRole.findFirst({
      where: { userId },
      select: { role: true, organizationId: true },
    }),
  );
  if (!role || role.role === "SUPER_ADMIN") return false;
  const sso = await runAsSystem("hive password sso", () =>
    prisma.hiveSso.findFirst({
      where: { organizationId: role.organizationId, enabled: true },
      select: { passwordLogin: true },
    }),
  );
  if (!sso) return false;
  return !hivePasswordAllowed(role.role, sso.passwordLogin);
}

export async function endHiveSessions(prisma: PrismaClient, userId: string): Promise<void> {
  await runAsSystem("end hive sessions", () => prisma.session.deleteMany({ where: { userId } }));
}

export async function revokeMissingHiveSso(
  prisma: PrismaClient,
  organizationId: string,
  present: string[],
): Promise<string[]> {
  const stored = await runAsSystem("read hive sso subjects", () =>
    prisma.hiveSsoSubject.findMany({
      where: { organizationId, removedAt: null },
      select: { subject: true, userId: true },
    }),
  );
  const userIds = hiveSsoRevokedUserIds(stored, present);
  if (userIds.length === 0) return [];
  const live = new Set(present);
  await runAsSystem("revoke hive sso subjects", async () => {
    await prisma.hiveSsoSubject.updateMany({
      where: { organizationId, subject: { notIn: [...live] }, removedAt: null },
      data: { removedAt: new Date() },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { hiveArchivedAt: new Date() },
    });
  });
  return userIds;
}
