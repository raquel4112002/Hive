import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  assignBotDepartment,
  deliverRoutineResult,
  ensureUserThread,
  inspectConversation,
  linkBotConnection,
  removeHivePerson,
  requestDedicatedComputer,
} from "./hive.js";
import { createThreadMessageInTransaction } from "./messages.js";
import { createRepos } from "./repos.js";
import { runAsSystem, runAsTenant } from "./row-security.js";
import { IsolationError } from "./scope.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("hive access (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `hive-org-${suffix}`;
  const spaceId = `hive-space-${suffix}`;
  const adminId = `hive-admin-${suffix}`;
  const superId = `hive-super-${suffix}`;
  const userA = `hive-a-${suffix}`;
  const userB = `hive-b-${suffix}`;
  const serviceId = `hive-service-${organizationId}`;
  const botId = `hive-bot-${suffix}`;
  const departmentId = `hive-area-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  const actor = (userId: string) => ({
    userId,
    spaceId,
    email: `${userId}@example.com`,
    isDeploymentOwner: false,
  });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    await runAsSystem("hive fixture", async () => {
      await prisma.organization.create({
        data: { id: organizationId, name: "Hive", slug: organizationId, createdAt: new Date() },
      });
      for (const [id, name] of [
        [adminId, "Admin"],
        [superId, "Super"],
        [userA, "A"],
        [userB, "B"],
        [serviceId, "Service"],
      ] as const) {
        await prisma.user.create({
          data: {
            id,
            name,
            email: `${id}@example.com`,
            emailVerified: true,
            hiveService: id === serviceId,
          },
        });
      }
      await prisma.space.create({ data: { id: spaceId, organizationId, name: "Space" } });
      await prisma.member.createMany({
        data: [adminId, superId, userA, userB].map((userId) => ({
          id: `member-${userId}`,
          organizationId,
          userId,
          role: userId === userA || userId === userB ? "member" : "owner",
          createdAt: new Date(),
        })),
      });
      await prisma.hiveRole.createMany({
        data: [
          { organizationId, userId: superId, role: "SUPER_ADMIN" },
          { organizationId, userId: adminId, role: "ADMIN" },
          { organizationId, userId: userA, role: "USER" },
          { organizationId, userId: userB, role: "USER" },
        ],
      });
      await prisma.department.create({
        data: { id: departmentId, organizationId, name: "Area", createdByUserId: adminId },
      });
      await prisma.departmentMember.createMany({
        data: [
          { departmentId, userId: userA },
          { departmentId, userId: userB },
        ],
      });
      await prisma.bot.create({
        data: { id: botId, spaceId, userId: serviceId, name: "Bot", color: "#111111" },
      });
    });
  });

  afterAll(async () => {
    if (prisma) {
      await runAsSystem("hive cleanup", async () => {
        await prisma.botUserComputer.deleteMany({ where: { botId } });
        await prisma.departmentMember.deleteMany({ where: { departmentId } });
        await prisma.botDepartmentAssignment.deleteMany({ where: { departmentId } });
        await prisma.department.deleteMany({ where: { id: departmentId } });
        await prisma.hiveRole.deleteMany({ where: { organizationId } });
        await prisma.organization.deleteMany({ where: { id: organizationId } });
        await prisma.user.deleteMany({
          where: { id: { in: [adminId, superId, userA, userB, serviceId] } },
        });
      });
    }
    await close?.();
  });

  it("hides an unassigned bot, then shows it to each person in the area", async () => {
    const repos = createRepos(prisma);
    expect(await runAsTenant(actor(userA), () => repos.listBots(actor(userA)))).toEqual([]);
    await assignBotDepartment(prisma, actor(adminId), botId, departmentId);
    const listed = await runAsTenant(actor(userA), () => repos.listBots(actor(userA)));
    expect(listed.map((bot) => bot.id)).toEqual([botId]);
    const other = await runAsTenant(actor(userB), () => repos.listBots(actor(userB)));
    expect(other.map((bot) => bot.id)).toEqual([botId]);
    const admin = await runAsTenant(actor(adminId), () => repos.listBots(actor(adminId)));
    expect(admin.map((bot) => bot.id)).toEqual([botId]);
    expect(admin[0]?.preview).toBe("");
  });

  it("gives the first person a thread and refuses to share it with the second", async () => {
    const first = await runAsTenant(actor(userA), () =>
      ensureUserThread(prisma, actor(userA), botId),
    );
    await runAsSystem("hive message", () =>
      prisma.$transaction((tx) =>
        createThreadMessageInTransaction(tx, {
          threadId: first.id,
          role: "user",
          blocks: [{ kind: "text", text: "secret" }],
        }),
      ),
    );
    await expect(
      runAsTenant(actor(userB), () => ensureUserThread(prisma, actor(userB), botId)),
    ).rejects.toBeInstanceOf(IsolationError);
    const seenByB = await runAsTenant(actor(userB), () =>
      prisma.message.findMany({ where: { threadId: first.id } }),
    );
    expect(seenByB).toEqual([]);
    const seenByAdmin = await runAsTenant(actor(adminId), () =>
      prisma.message.findMany({ where: { threadId: first.id } }),
    );
    expect(seenByAdmin).toEqual([]);
    const opened = await runAsTenant(actor(superId), () =>
      inspectConversation(prisma, actor(superId), { threadId: first.id, reason: "review" }),
    );
    expect(opened.messages.map((message) => message.text)).toContain("secret");
    await expect(
      runAsTenant(actor(adminId), () =>
        inspectConversation(prisma, actor(adminId), { threadId: first.id, reason: "no" }),
      ),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("refuses a personal connection and keeps the bot when the admin is removed", async () => {
    const personal = await runAsSystem("hive connection", () =>
      prisma.connection.create({
        data: {
          spaceId,
          userId: adminId,
          provider: "mail",
          displayName: "Personal",
          status: "connected",
        },
      }),
    );
    await expect(
      linkBotConnection(prisma, actor(adminId), botId, personal.id),
    ).rejects.toBeInstanceOf(IsolationError);
    const serviceConnection = await runAsSystem("hive service connection", () =>
      prisma.connection.create({
        data: {
          spaceId,
          userId: serviceId,
          provider: "mail",
          displayName: "Organization",
          status: "connected",
        },
      }),
    );
    await linkBotConnection(prisma, actor(adminId), botId, serviceConnection.id);
    const plan = await removeHivePerson(prisma, actor(superId), adminId);
    expect(plan.mode).toBe("archive");
    const bot = await runAsSystem("hive bot still there", () =>
      prisma.bot.findUnique({ where: { id: botId }, select: { userId: true } }),
    );
    expect(bot?.userId).toBe(serviceId);
    const link = await runAsSystem("hive link still there", () =>
      prisma.botConnection.findFirst({ where: { botId, connectionId: serviceConnection.id } }),
    );
    expect(link).not.toBeNull();
    expect(
      await runAsTenant(actor(userA), () => createRepos(prisma).listBots(actor(userA))),
    ).toHaveLength(1);
  });

  it("queues a dedicated computer when the global limit is full", async () => {
    const previousLimit = process.env.HIVE_MAX_ACTIVE_COMPUTERS;
    const previousIdle = process.env.HIVE_COMPUTER_IDLE_MINUTES;
    process.env.HIVE_MAX_ACTIVE_COMPUTERS = "1";
    process.env.HIVE_COMPUTER_IDLE_MINUTES = "30";
    try {
      const now = new Date("2026-11-01T00:00:00.000Z");
      const first = await requestDedicatedComputer(prisma, { botId, userId: userA, now });
      const second = await requestDedicatedComputer(prisma, {
        botId,
        userId: userB,
        now: new Date(now.getTime() + 1000),
      });
      expect(first.state).toBe("running");
      expect(second.state).toBe("queued");
    } finally {
      if (previousLimit === undefined) delete process.env.HIVE_MAX_ACTIVE_COMPUTERS;
      else process.env.HIVE_MAX_ACTIVE_COMPUTERS = previousLimit;
      if (previousIdle === undefined) delete process.env.HIVE_COMPUTER_IDLE_MINUTES;
      else process.env.HIVE_COMPUTER_IDLE_MINUTES = previousIdle;
    }
  });

  it("does not deliver a routine into the other person's thread", async () => {
    const routine = await runAsSystem("hive routine", () =>
      prisma.routine.create({
        data: {
          spaceId,
          botId,
          userId: serviceId,
          name: "Daily",
          prompt: "Report",
          crons: [],
        },
      }),
    );
    await runAsSystem("hive recipients", () =>
      prisma.routineRecipient.create({ data: { routineId: routine.id, departmentId } }),
    );
    const shared = await prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'threads_botId_key'
      ) AS present
    `;
    if (shared[0]?.present) {
      await expect(
        deliverRoutineResult(prisma, { routineId: routine.id, botId, spaceId, text: "done" }),
      ).rejects.toBeInstanceOf(IsolationError);
      const threads = await runAsSystem("hive threads", () =>
        prisma.thread.findMany({ where: { botId }, select: { userId: true } }),
      );
      expect(threads.map((thread) => thread.userId)).toEqual([userA]);
      return;
    }
    const delivered = await deliverRoutineResult(prisma, {
      routineId: routine.id,
      botId,
      spaceId,
      text: "done",
    });
    expect(delivered).toEqual([userA, userB].sort());
  });
});
