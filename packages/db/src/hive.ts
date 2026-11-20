// Hive modification: roles, private threads, service connections, and computers.
// Derived from Rakazo (Apache License 2.0).

import { createHash } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import { recordAuditEvent } from "./audit-events.js";
import type { Prisma, PrismaClient } from "./client.js";
import {
  type ComputerSlot,
  EVERYONE_DEPARTMENT_NAME,
  type HiveAccessLevel,
  type HiveRoleName,
  asAccessLevel,
  conversationAllowed,
  delegationAllowed,
  effectiveAccess,
  hiveComputerLimits,
  personRemovalPlan,
  requestComputer,
  routineRecipientUserIds,
  serviceAccountEmail,
  serviceAccountId,
  serviceConnectionOwner,
} from "./hive-access.js";
import { createThreadMessageInTransaction } from "./messages.js";
import { runAsSystem } from "./row-security.js";
import { IsolationError } from "./scope.js";

export interface HiveActorRole {
  role: HiveRoleName;
  organizationId: string;
  archived: boolean;
}

const INSPECT_MS = 15 * 60 * 1000;

function asRole(role: string): HiveRoleName {
  if (role === "SUPER_ADMIN" || role === "ADMIN" || role === "USER") return role;
  return "USER";
}

function uniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (record.code === "P2002" || record.code === "23505") return true;
  if (typeof record.message === "string" && record.message.toLowerCase().includes("unique")) {
    return true;
  }
  return uniqueConflict(record.cause);
}

/** Partial test clients have no Hive tables. They keep the legacy owner path. */
function hiveClientReady(prisma: PrismaClient | null | undefined): boolean {
  if (!prisma) return false;
  return (
    typeof prisma.space?.findUnique === "function" &&
    typeof prisma.user?.findUnique === "function" &&
    typeof prisma.hiveRole?.findUnique === "function"
  );
}

async function organizationIdForSpace(prisma: PrismaClient, spaceId: string): Promise<string | null> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { organizationId: true },
  });
  return space?.organizationId ?? null;
}

export async function readHiveRole(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
): Promise<HiveActorRole | null> {
  if (!hiveClientReady(prisma)) return null;
  return runAsSystem("read hive role", async () => {
    const organizationId = await organizationIdForSpace(prisma, actor.spaceId);
    if (!organizationId) return null;
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { hiveArchivedAt: true, hiveService: true },
    });
    if (!user || user.hiveService) return null;
    const row = await prisma.hiveRole.findUnique({
      where: { organizationId_userId: { organizationId, userId: actor.userId } },
    });
    if (!row) return null;
    return {
      role: asRole(row.role),
      organizationId,
      archived: user.hiveArchivedAt != null,
    };
  });
}

/** Organizations that already have roles assign one to a member on first use. */
export async function ensureMemberRole(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
): Promise<HiveActorRole | null> {
  if (!hiveClientReady(prisma)) return null;
  const current = await readHiveRole(prisma, actor);
  if (current) return current;
  return runAsSystem("ensure hive role", async () => {
    const organizationId = await organizationIdForSpace(prisma, actor.spaceId);
    if (!organizationId) return null;
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { hiveArchivedAt: true, hiveService: true },
    });
    if (!user || user.hiveService) return null;
    const enabled = await prisma.hiveRole.count({ where: { organizationId } });
    if (enabled === 0) return null;
    const member = await prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId: actor.userId } },
    });
    if (!member) return null;
    let role: HiveRoleName = "USER";
    if (member.role === "owner") {
      const supers = await prisma.hiveRole.count({
        where: { organizationId, role: "SUPER_ADMIN" },
      });
      role = supers > 0 ? "ADMIN" : "SUPER_ADMIN";
    }
    try {
      await prisma.hiveRole.create({ data: { organizationId, userId: actor.userId, role } });
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
    }
    await joinEveryone(prisma, organizationId, actor.userId);
    return { role, organizationId, archived: user.hiveArchivedAt != null };
  });
}

export async function ensureServiceAccount(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string> {
  const id = serviceAccountId(organizationId);
  await runAsSystem("hive service account", async () => {
    await prisma.user.upsert({
      where: { id },
      update: { hiveService: true },
      create: {
        id,
        name: "Service",
        email: serviceAccountEmail(organizationId),
        emailVerified: true,
        hiveService: true,
      },
    });
  });
  return id;
}

export async function visibleBotIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const [direct, memberships] = await Promise.all([
    prisma.botAssignment.findMany({ where: { userId }, select: { botId: true } }),
    prisma.departmentMember.findMany({ where: { userId }, select: { departmentId: true } }),
  ]);
  const area = memberships.length
    ? await prisma.botDepartmentAssignment.findMany({
        where: { departmentId: { in: memberships.map((member) => member.departmentId) } },
        select: { botId: true },
      })
    : [];
  return [...new Set([...direct, ...area].map((row) => row.botId))];
}

export async function botsWhereForActor(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  archived: boolean | "any",
): Promise<Prisma.BotWhereInput> {
  const hive = await ensureMemberRole(prisma, actor);
  const archivedAt = archived === "any" ? undefined : archived ? { not: null } : null;
  const base: Prisma.BotWhereInput = {
    spaceId: actor.spaceId,
    ...(archivedAt === undefined ? {} : { archivedAt }),
  };
  if (!hive) return { ...base, userId: actor.userId };
  if (hive.archived) return { ...base, id: { in: [] } };
  if (hive.role === "USER") {
    const ids = await visibleBotIds(prisma, actor.userId);
    return { ...base, id: { in: ids } };
  }
  return base;
}

/** One bot inside an actor's scope. A flat scope stays flat so existing lookups keep working. */
export function scopedBotWhere(scope: Prisma.BotWhereInput, id: string): Prisma.BotWhereInput {
  if ("AND" in scope || "OR" in scope || "NOT" in scope || "id" in scope) {
    return { AND: [scope, { id }] };
  }
  return { ...scope, id };
}

export async function threadsForActor(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  botIds: string[],
) {
  const map = new Map<
    string,
    Awaited<ReturnType<PrismaClient["thread"]["findMany"]>>[number]
  >();
  if (botIds.length === 0) return map;
  if (typeof prisma.thread?.findMany !== "function") return map;
  const hive = await readHiveRole(prisma, actor);
  if (hive?.archived) return map;
  const rows = await prisma.thread.findMany({
    where: { botId: { in: botIds }, userId: actor.userId, routineId: null },
  });
  for (const row of rows) {
    if (row.botId) map.set(row.botId, row);
  }
  return map;
}

export async function ensureUserThread(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  botId: string,
) {
  const hive = await readHiveRole(prisma, actor);
  if (hive?.archived) throw new IsolationError();
  const where = await botsWhereForActor(prisma, actor, false);
  const bot = await prisma.bot.findFirst({
    where: scopedBotWhere(where, botId),
    select: { id: true, publication: true },
  });
  if (!bot) throw new IsolationError();
  if (hive) {
    const access = await effectiveAccessFor(prisma, actor.userId, botId);
    if (!conversationAllowed({ access, publication: bot.publication })) throw new IsolationError();
  }
  const existing = await prisma.thread.findFirst({
    where: { botId, userId: actor.userId, routineId: null },
  });
  if (existing) return existing;
  try {
    return await prisma.thread.create({
      data: { spaceId: actor.spaceId, botId, userId: actor.userId },
    });
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    const again = await prisma.thread.findFirst({
      where: { botId, userId: actor.userId, routineId: null },
    });
    if (again) return again;
    throw new IsolationError();
  }
}

export async function ensureRoutineThread(
  prisma: PrismaClient,
  input: { routineId: string; botId: string; spaceId: string },
) {
  if (typeof prisma.bot.findFirst !== "function") return null;
  const bot = await prisma.bot.findFirst({
    where: { id: input.botId, spaceId: input.spaceId },
    select: { userId: true },
  });
  if (!bot?.userId || typeof prisma.user?.findUnique !== "function") return null;
  const owner = await prisma.user.findUnique({
    where: { id: bot.userId },
    select: { hiveService: true },
  });
  if (!owner?.hiveService) return null;
  const existing = await prisma.thread.findFirst({ where: { routineId: input.routineId } });
  if (existing) return existing;
  try {
    return await prisma.thread.create({
      data: {
        spaceId: input.spaceId,
        botId: input.botId,
        userId: bot.userId,
        routineId: input.routineId,
      },
    });
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    const again = await prisma.thread.findFirst({ where: { routineId: input.routineId } });
    if (again) return again;
    throw new IsolationError();
  }
}

export async function deliverRoutineResult(
  prisma: PrismaClient,
  input: {
    routineId: string;
    botId: string;
    spaceId: string;
    text: string;
    routineRunId?: string | null;
    artifacts?: Array<{ name: string; body: string }>;
  },
): Promise<string[]> {
  return runAsSystem("deliver hive routine", () => deliverRoutineResultAsSystem(prisma, input));
}

async function deliverRoutineResultAsSystem(
  prisma: PrismaClient,
  input: {
    routineId: string;
    botId: string;
    spaceId: string;
    text: string;
    routineRunId?: string | null;
    artifacts?: Array<{ name: string; body: string }>;
  },
): Promise<string[]> {
  const bot = await prisma.bot.findFirst({
    where: { id: input.botId },
    select: { publication: true },
  });
  if (bot?.publication) {
    const post = await prisma.botPost.create({
      data: {
        botId: input.botId,
        routineRunId: input.routineRunId ?? null,
        content: input.text,
        artifacts: {
          create: (input.artifacts ?? []).map((artifact) => ({
            name: artifact.name,
            body: artifact.body,
          })),
        },
      },
    });
    await recordAuditEvent({
      action: "hive.post.publish",
      actor: { type: "bot", id: input.botId, label: "publication" },
      spaceId: input.spaceId,
      target: { type: "post", id: post.id },
      metadata: { botId: input.botId, postId: post.id },
    });
    return [];
  }
  const recipients = await prisma.routineRecipient.findMany({ where: { routineId: input.routineId } });
  const departmentIds = recipients.flatMap((recipient) =>
    recipient.departmentId ? [recipient.departmentId] : [],
  );
  const departmentMembers = departmentIds.length
    ? await prisma.departmentMember.findMany({ where: { departmentId: { in: departmentIds } } })
    : [];
  let userIds = routineRecipientUserIds({ recipients, departmentMembers });
  if (userIds.length === 0) {
    const routine = await prisma.routine.findUnique({
      where: { id: input.routineId },
      select: { userId: true, notify: true },
    });
    const owner = routine
      ? await prisma.user.findUnique({
          where: { id: routine.userId },
          select: { hiveService: true },
        })
      : null;
    if (routine?.notify && owner && !owner.hiveService) userIds = [routine.userId];
  }
  const delivered: string[] = [];
  for (const userId of userIds) {
    const thread = await ensureUserThread(prisma, { userId, spaceId: input.spaceId }, input.botId);
    await prisma.$transaction(async (tx) => {
      await createThreadMessageInTransaction(tx, {
        threadId: thread.id,
        role: "bot",
        botId: input.botId,
        blocks: [{ kind: "text", text: input.text }],
      });
    });
    delivered.push(userId);
  }
  return delivered;
}

async function requireManager(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
): Promise<HiveActorRole> {
  const hive = await readHiveRole(prisma, actor);
  if (!hive || hive.archived || hive.role === "USER") throw new IsolationError();
  return hive;
}

export async function ensureEveryoneDepartment(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string> {
  return runAsSystem("hive everyone", async () => {
    const existing = await prisma.department.findFirst({
      where: { organizationId, system: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    const clash = await prisma.department.findFirst({
      where: { organizationId, name: EVERYONE_DEPARTMENT_NAME, system: false },
      select: { id: true, name: true },
    });
    if (clash) {
      await prisma.department.update({
        where: { id: clash.id },
        data: { name: `${clash.name} (2)` },
      });
    }
    const created = await prisma.department.create({
      data: {
        organizationId,
        name: EVERYONE_DEPARTMENT_NAME,
        system: true,
        createdByUserId: "",
      },
    });
    const roles = await prisma.hiveRole.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    if (roles.length > 0) {
      await prisma.departmentMember.createMany({
        data: roles.map((role) => ({ departmentId: created.id, userId: role.userId })),
        skipDuplicates: true,
      });
    }
    return created.id;
  });
}

export async function joinEveryone(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const departmentId = await ensureEveryoneDepartment(prisma, organizationId);
  await runAsSystem("hive everyone member", () =>
    prisma.departmentMember.upsert({
      where: { departmentId_userId: { departmentId, userId } },
      update: {},
      create: { departmentId, userId },
    }),
  );
}

export async function deleteHiveDepartment(
  prisma: PrismaClient,
  actor: Actor,
  departmentId: string,
): Promise<void> {
  await requireManager(prisma, actor);
  const department = await runAsSystem("read hive department", () =>
    prisma.department.findFirst({ where: { id: departmentId }, select: { system: true } }),
  );
  if (!department || department.system) throw new IsolationError();
  await runAsSystem("delete hive department", () =>
    prisma.department.delete({ where: { id: departmentId } }),
  );
}

export async function renameHiveDepartment(
  prisma: PrismaClient,
  actor: Actor,
  departmentId: string,
  name: string,
): Promise<void> {
  await requireManager(prisma, actor);
  const department = await runAsSystem("read hive department", () =>
    prisma.department.findFirst({ where: { id: departmentId }, select: { system: true } }),
  );
  if (!department || department.system) throw new IsolationError();
  await runAsSystem("rename hive department", () =>
    prisma.department.update({ where: { id: departmentId }, data: { name } }),
  );
}

export async function effectiveAccessFor(
  prisma: PrismaClient,
  userId: string,
  botId: string,
): Promise<HiveAccessLevel | null> {
  if (!hiveClientReady(prisma)) return null;
  return runAsSystem("hive access", async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hiveArchivedAt: true },
    });
    if (user?.hiveArchivedAt) return null;
    const direct = await prisma.botAssignment.findUnique({
      where: { botId_userId: { botId, userId } },
      select: { accessLevel: true },
    });
    const memberships = await prisma.departmentMember.findMany({
      where: { userId },
      select: { departmentId: true },
    });
    const areas = memberships.length
      ? await prisma.botDepartmentAssignment.findMany({
          where: { botId, departmentId: { in: memberships.map((member) => member.departmentId) } },
          select: { accessLevel: true },
        })
      : [];
    return effectiveAccess([
      ...(direct ? [asAccessLevel(direct.accessLevel)] : []),
      ...areas.map((area) => asAccessLevel(area.accessLevel)),
    ]);
  });
}

export async function accessLevelsFor(
  prisma: PrismaClient,
  userId: string,
  botIds: string[],
): Promise<Map<string, HiveAccessLevel>> {
  const levels = new Map<string, HiveAccessLevel>();
  if (!hiveClientReady(prisma) || botIds.length === 0) return levels;
  await Promise.all(
    botIds.map(async (botId) => {
      const access = await effectiveAccessFor(prisma, userId, botId);
      if (access) levels.set(botId, access);
    }),
  );
  return levels;
}

export async function setBotPublication(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  publication: boolean,
): Promise<void> {
  await requireManager(prisma, actor);
  const updated = await runAsSystem("set hive publication", () =>
    prisma.bot.updateMany({
      where: { id: botId, spaceId: actor.spaceId },
      data: { publication },
    }),
  );
  if (updated.count === 0) throw new IsolationError();
}

export async function listBotPosts(prisma: PrismaClient, botId: string) {
  return prisma.botPost.findMany({
    where: { botId },
    orderBy: { createdAt: "desc" },
    include: { artifacts: { select: { id: true, name: true } } },
  });
}

export async function readBotPostArtifact(prisma: PrismaClient, artifactId: string) {
  const artifact = await prisma.botPostArtifact.findFirst({
    where: { id: artifactId },
    select: { name: true, body: true },
  });
  if (!artifact) throw new IsolationError();
  return artifact;
}

export async function assignBotUser(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  userId: string,
  accessLevel: HiveAccessLevel = "CHAT",
): Promise<void> {
  const hive = await requireManager(prisma, actor);
  const person = await runAsSystem("read hive assignee", () =>
    prisma.hiveRole.findUnique({
      where: { organizationId_userId: { organizationId: hive.organizationId, userId } },
    }),
  );
  if (!person) throw new IsolationError();
  await runAsSystem("assign hive bot", async () => {
    await prisma.botAssignment.upsert({
      where: { botId_userId: { botId, userId } },
      update: { accessLevel },
      create: { botId, userId, assignedByUserId: actor.userId, accessLevel },
    });
    await prisma.bot.updateMany({
      where: { id: botId, spaceId: actor.spaceId },
      data: { crossSpaceCommunication: false },
    });
  });
  await recordAuditEvent({
    action: "hive.bot.assign_user",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: "bot", id: botId },
    metadata: { userId },
  });
}

export async function assignBotDepartment(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  departmentId: string,
  accessLevel: HiveAccessLevel = "CHAT",
): Promise<void> {
  const hive = await requireManager(prisma, actor);
  const department = await runAsSystem("read hive department", () =>
    prisma.department.findFirst({
      where: { id: departmentId, organizationId: hive.organizationId },
      select: { id: true },
    }),
  );
  if (!department) throw new IsolationError();
  await runAsSystem("assign hive department", async () => {
    await prisma.botDepartmentAssignment.upsert({
      where: { botId_departmentId: { botId, departmentId } },
      update: { accessLevel },
      create: { botId, departmentId, assignedByUserId: actor.userId, accessLevel },
    });
    await prisma.bot.updateMany({
      where: { id: botId, spaceId: actor.spaceId },
      data: { crossSpaceCommunication: false },
    });
  });
  await recordAuditEvent({
    action: "hive.bot.assign_department",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: "bot", id: botId },
    metadata: { departmentId },
  });
}

export async function linkBotConnection(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  connectionId: string,
): Promise<void> {
  const hive = await requireManager(prisma, actor);
  const serviceId = await ensureServiceAccount(prisma, hive.organizationId);
  const connection = await runAsSystem("read hive connection", () =>
    prisma.connection.findFirst({
      where: { id: connectionId, spaceId: actor.spaceId },
      select: { userId: true },
    }),
  );
  if (!connection || !serviceConnectionOwner(connection.userId, serviceId)) throw new IsolationError();
  await runAsSystem("link hive connection", async () => {
    await prisma.botConnection.upsert({
      where: { botId_connectionId: { botId, connectionId } },
      update: {},
      create: { botId, connectionId, createdByUserId: actor.userId },
    });
  });
  await recordAuditEvent({
    action: "hive.bot.connect",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: "connection", id: connectionId },
    metadata: { botId },
  });
}

export async function hiveConnectionOwnerId(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
): Promise<string> {
  const hive = await readHiveRole(prisma, actor);
  if (!hive || hive.archived || hive.role === "USER") return actor.userId;
  return ensureServiceAccount(prisma, hive.organizationId);
}

async function deletePersonContent(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.thread.deleteMany({ where: { userId } });
  await prisma.memoryDocument.deleteMany({ where: { userId } });
  await prisma.artifact.deleteMany({ where: { userId } });
  await prisma.scratchpadItem.deleteMany({ where: { userId } });
}

export async function removeHivePerson(
  prisma: PrismaClient,
  actor: Actor,
  userId: string,
  now = new Date(),
) {
  const hive = await requireManager(prisma, actor);
  if (hive.role !== "SUPER_ADMIN" && hive.role !== "ADMIN") throw new IsolationError();
  const target = await runAsSystem("read hive member", () =>
    prisma.hiveRole.findUnique({
      where: { organizationId_userId: { organizationId: hive.organizationId, userId } },
    }),
  );
  if (!target) throw new IsolationError();
  if (target.role === "SUPER_ADMIN") {
    const supers = await prisma.hiveRole.count({
      where: { organizationId: hive.organizationId, role: "SUPER_ADMIN" },
    });
    if (supers <= 1) throw new IsolationError();
  }
  const settings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
  const plan = personRemovalPlan(settings, now);
  await runAsSystem("remove hive person", async () => {
    await prisma.conversationGrant.deleteMany({ where: { actorUserId: userId } });
    await prisma.hiveRole.deleteMany({ where: { organizationId: hive.organizationId, userId } });
    await prisma.departmentMember.deleteMany({ where: { userId } });
    await prisma.botAssignment.deleteMany({ where: { userId } });
    if (plan.mode === "delete") await deletePersonContent(prisma, userId);
    await prisma.user.update({
      where: { id: userId },
      data: {
        hiveArchivedAt: now,
        hiveDeleteAfter: plan.mode === "archive" ? plan.deleteAfter : null,
      },
    });
  });
  await recordAuditEvent({
    action: "hive.member.remove",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: "user", id: userId },
    metadata: { mode: plan.mode },
  });
  return plan;
}

function messageText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) =>
      block && typeof block === "object" && "text" in block && typeof block.text === "string"
        ? block.text
        : "",
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

export async function inspectConversation(
  prisma: PrismaClient,
  actor: Actor,
  input: { threadId: string; reason: string; now?: Date },
) {
  const hive = await readHiveRole(prisma, actor);
  if (!hive || hive.archived || hive.role !== "SUPER_ADMIN") throw new IsolationError();
  const now = input.now ?? new Date();
  const thread = await runAsSystem("inspect hive thread", () =>
    prisma.thread.findFirst({
      where: { id: input.threadId, spaceId: actor.spaceId },
      select: { id: true },
    }),
  );
  if (!thread) throw new IsolationError();
  const expiresAt = new Date(now.getTime() + INSPECT_MS);
  await runAsSystem("open hive inspect", () =>
    prisma.conversationGrant.create({
      data: {
        threadId: input.threadId,
        actorUserId: actor.userId,
        reason: input.reason,
        expiresAt,
      },
    }),
  );
  const messages = await prisma.message.findMany({
    where: { threadId: input.threadId },
    orderBy: { seq: "asc" },
    select: { id: true, role: true, blocks: true },
  });
  await recordAuditEvent({
    action: "hive.conversation.read",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: "thread", id: input.threadId },
    metadata: { reason: input.reason, expiresAt: expiresAt.toISOString() },
  });
  return {
    threadId: input.threadId,
    expiresAt,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: messageText(message.blocks),
    })),
  };
}

export async function hiveServiceBot(
  prisma: PrismaClient,
  botId: string,
  spaceId: string,
): Promise<{ userId: string } | null> {
  if (!hiveClientReady(prisma) || typeof prisma.bot.findFirst !== "function") return null;
  const bot = await prisma.bot.findFirst({
    where: { id: botId, spaceId },
    select: { userId: true },
  });
  if (!bot) return null;
  const owner = await prisma.user.findUnique({
    where: { id: bot.userId },
    select: { hiveService: true },
  });
  if (!owner?.hiveService) return null;
  return { userId: bot.userId };
}

/** A person's own computer for a service bot. Routines and publications keep the bot computer. */
export async function ensureHiveConversationComputer(
  prisma: PrismaClient,
  input: { botId: string; userId: string; spaceId: string },
): Promise<string | null> {
  if (!hiveClientReady(prisma) || typeof prisma.computer?.upsert !== "function") return null;
  const service = await hiveServiceBot(prisma, input.botId, input.spaceId);
  if (!service) return null;
  const bot = await prisma.bot.findFirst({
    where: { id: input.botId, spaceId: input.spaceId },
    select: { publication: true, userId: true },
  });
  if (!bot?.userId || bot.publication) return null;
  const access = await effectiveAccessFor(prisma, input.userId, input.botId);
  if (!conversationAllowed({ access, publication: false })) return null;
  const scopeKey = `hive:${input.botId}:${input.userId}`;
  const homeKey = `hive-${createHash("sha256").update(scopeKey).digest("hex").slice(0, 32)}`;
  return runAsSystem("hive conversation computer", async () => {
    const computer = await prisma.computer.upsert({
      where: { scopeKey },
      create: {
        spaceId: input.spaceId,
        userId: bot.userId,
        scope: "dedicated",
        scopeKey,
        homeKey,
        kind: process.env.SANDBOX_PROVIDER?.trim() || "docker",
      },
      update: {},
    });
    await prisma.botUserComputer.upsert({
      where: { botId_userId: { botId: input.botId, userId: input.userId } },
      create: {
        botId: input.botId,
        userId: input.userId,
        computerId: computer.id,
        state: "queued",
        queuedAt: new Date(),
      },
      update: { computerId: computer.id },
    });
    return computer.id;
  });
}

export async function hiveConnectionWhere(
  prisma: PrismaClient,
  botId: string,
  spaceId: string,
): Promise<{ id: { in: string[] } } | null> {
  const service = await hiveServiceBot(prisma, botId, spaceId);
  if (!service) return null;
  const links = await prisma.botConnection.findMany({
    where: { botId },
    select: { connectionId: true },
  });
  return { id: { in: links.map((link) => link.connectionId) } };
}

export async function speakerMayDelegate(
  prisma: PrismaClient,
  parentBotId: string,
  speakerUserId: string,
  targetBotId: string,
  spaceId: string,
): Promise<boolean> {
  const service = await hiveServiceBot(prisma, parentBotId, spaceId);
  if (!service) return true;
  const ids = await visibleBotIds(prisma, speakerUserId);
  return delegationAllowed(ids, targetBotId);
}

export async function hiveScreenDecision(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  botId: string,
): Promise<"legacy" | "allow" | "deny"> {
  const service = await hiveServiceBot(prisma, botId, actor.spaceId);
  if (!service) return "legacy";
  const hive = await readHiveRole(prisma, actor);
  if (!hive || hive.archived || hive.role !== "USER") return "deny";
  const slot = await prisma.botUserComputer.findUnique({
    where: { botId_userId: { botId, userId: actor.userId } },
  });
  if (!slot?.computerId) return "deny";
  const computer = await prisma.computer.findUnique({
    where: { id: slot.computerId },
    select: { scope: true },
  });
  if (
    !computer ||
    computer.scope !== "dedicated" ||
    slot.state !== "running" ||
    slot.userId !== actor.userId
  ) {
    return "deny";
  }
  return "allow";
}

function slotKey(botId: string, userId: string): string {
  return `${botId}\n${userId}`;
}

export async function requestDedicatedComputer(
  prisma: PrismaClient,
  input: { botId: string; userId: string; now?: Date },
): Promise<ComputerSlot> {
  const now = input.now ?? new Date();
  if (hiveClientReady(prisma)) {
    const allowed = await runAsSystem("hive computer access", async () => {
      const bot = await prisma.bot.findFirst({
        where: { id: input.botId },
        select: { publication: true },
      });
      const access = await effectiveAccessFor(prisma, input.userId, input.botId);
      return conversationAllowed({ access, publication: Boolean(bot?.publication) });
    });
    if (!allowed) throw new IsolationError();
  }
  const limits = hiveComputerLimits();
  const limit = limits.activeLimit;
  const idleMs = limits.idleMinutes * 60 * 1000;
  const key = slotKey(input.botId, input.userId);
  return runAsSystem("hive dedicated computer", async () => {
    const rows = await prisma.botUserComputer.findMany();
    const slots: ComputerSlot[] = rows.map((row) => ({
      key: slotKey(row.botId, row.userId),
      state: row.state === "running" || row.state === "queued" ? row.state : "stopped",
      lastActiveAt: row.lastActiveAt?.getTime() ?? null,
      queuedAt: row.queuedAt?.getTime() ?? null,
    }));
    const next = requestComputer(slots, key, now.getTime(), idleMs, limit);
    const known = new Map(rows.map((row) => [slotKey(row.botId, row.userId), row]));
    for (const slot of next) {
      const [botId, userId] = slot.key.split("\n");
      if (!botId || !userId) continue;
      const current = known.get(slot.key);
      const data = {
        state: slot.state,
        lastActiveAt: slot.lastActiveAt == null ? null : new Date(slot.lastActiveAt),
        queuedAt: slot.queuedAt == null ? null : new Date(slot.queuedAt),
      };
      if (!current) {
        await prisma.botUserComputer.create({ data: { botId, userId, ...data } });
      } else if (
        current.state !== data.state ||
        current.lastActiveAt?.getTime() !== data.lastActiveAt?.getTime() ||
        current.queuedAt?.getTime() !== data.queuedAt?.getTime()
      ) {
        await prisma.botUserComputer.update({ where: { id: current.id }, data });
      }
    }
    const mine = next.find((slot) => slot.key === key);
    if (!mine) throw new IsolationError();
    return mine;
  });
}
