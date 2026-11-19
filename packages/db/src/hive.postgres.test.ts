import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  assignBotDepartment,
  assignBotUser,
  deleteHiveDepartment,
  deliverRoutineResult,
  effectiveAccessFor,
  ensureEveryoneDepartment,
  ensureMemberRole,
  ensureRoutineThread,
  ensureUserThread,
  inspectConversation,
  linkBotConnection,
  listBotPosts,
  removeHivePerson,
  renameHiveDepartment,
  requestDedicatedComputer,
  setBotPublication,
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

  it("keeps two people on the same bot in private threads", async () => {
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
    const second = await runAsTenant(actor(userB), () =>
      ensureUserThread(prisma, actor(userB), botId),
    );
    expect(second.id).not.toBe(first.id);
    await runAsSystem("hive message b", () =>
      prisma.$transaction((tx) =>
        createThreadMessageInTransaction(tx, {
          threadId: second.id,
          role: "user",
          blocks: [{ kind: "text", text: "from-b" }],
        }),
      ),
    );
    const listedA = await runAsTenant(actor(userA), () => createRepos(prisma).listBots(actor(userA)));
    const listedB = await runAsTenant(actor(userB), () => createRepos(prisma).listBots(actor(userB)));
    expect(listedA.map((bot) => bot.preview)).toContain("secret");
    expect(listedB.map((bot) => bot.preview)).toContain("from-b");
    expect(listedB.map((bot) => bot.preview).join(" ")).not.toContain("secret");
    expect(listedA.map((bot) => bot.preview).join(" ")).not.toContain("from-b");
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
    const delivered = await deliverRoutineResult(prisma, {
      routineId: routine.id,
      botId,
      spaceId,
      text: "done",
    });
    expect(delivered).toEqual([userA, userB].sort());
    const seenByB = await runAsTenant(actor(userB), () =>
      prisma.message.findMany({
        where: { thread: { botId, userId: userB, routineId: null } },
        select: { blocks: true },
      }),
    );
    const texts = seenByB.map((message) => JSON.stringify(message.blocks));
    expect(texts.some((text) => text.includes("done"))).toBe(true);
    expect(texts.some((text) => text.includes("secret"))).toBe(false);
    const routineThread = await runAsSystem("hive routine thread", () =>
      ensureRoutineThread(prisma, { routineId: routine.id, botId, spaceId }),
    );
    const personal = await runAsSystem("hive personal threads", () =>
      prisma.thread.findMany({
        where: { botId, userId: { in: [userA, userB] }, routineId: null },
        select: { id: true },
      }),
    );
    expect(routineThread?.userId).toBe(serviceId);
    expect(personal.map((thread) => thread.id)).not.toContain(routineThread?.id);
  });

  it("assigns Todos to both people and refuses to rename or delete it", async () => {
    const everyoneId = await ensureEveryoneDepartment(prisma, organizationId);
    const feedBot = `${botId}-todos`;
    await runAsSystem("hive todos bot", () =>
      prisma.bot.create({
        data: { id: feedBot, spaceId, userId: serviceId, name: "Todos bot", color: "#111111" },
      }),
    );
    await assignBotDepartment(prisma, actor(superId), feedBot, everyoneId, "CHAT");
    const listedA = await runAsTenant(actor(userA), () => createRepos(prisma).listBots(actor(userA)));
    const listedB = await runAsTenant(actor(userB), () => createRepos(prisma).listBots(actor(userB)));
    expect(listedA.map((bot) => bot.id)).toContain(feedBot);
    expect(listedB.map((bot) => bot.id)).toContain(feedBot);
    await expect(deleteHiveDepartment(prisma, actor(superId), everyoneId)).rejects.toBeInstanceOf(
      IsolationError,
    );
    await expect(
      renameHiveDepartment(prisma, actor(superId), everyoneId, "Other"),
    ).rejects.toBeInstanceOf(IsolationError);
    const still = await runAsSystem("hive todos still", () =>
      prisma.department.findUnique({ where: { id: everyoneId }, select: { name: true } }),
    );
    expect(still?.name).toBe("Todos");
  });

  it("lets a chat area win over a read-only direct assignment", async () => {
    await assignBotUser(prisma, actor(superId), botId, userA, "READ_ONLY");
    expect(await effectiveAccessFor(prisma, userA, botId)).toBe("CHAT");
  });

  it("keeps a publication in the feed and out of personal threads", async () => {
    const feedBot = `${botId}-feed`;
    await runAsSystem("hive feed bot", () =>
      prisma.bot.create({
        data: {
          id: feedBot,
          spaceId,
          userId: serviceId,
          name: "Feed",
          color: "#111111",
          publication: true,
        },
      }),
    );
    await setBotPublication(prisma, actor(superId), feedBot, true);
    const everyone = await runAsSystem("hive everyone id", () =>
      prisma.department.findFirst({
        where: { organizationId, system: true },
        select: { id: true },
      }),
    );
    if (!everyone) throw new Error("Todos is missing");
    await assignBotDepartment(prisma, actor(superId), feedBot, everyone.id, "READ_ONLY");
    const outsider = `hive-out-${suffix}`;
    await runAsSystem("hive outsider", async () => {
      await prisma.user.create({
        data: { id: outsider, name: "Out", email: `${outsider}@example.com`, emailVerified: true },
      });
      await prisma.hiveRole.create({ data: { organizationId, userId: outsider, role: "USER" } });
    });
    const routine = await runAsSystem("hive feed routine", () =>
      prisma.routine.create({
        data: {
          spaceId,
          botId: feedBot,
          userId: serviceId,
          name: "Publish",
          prompt: "publish",
          crons: [],
          notify: false,
        },
      }),
    );
    await deliverRoutineResult(prisma, {
      routineId: routine.id,
      botId: feedBot,
      spaceId,
      text: "published",
      artifacts: [{ name: "note.txt", body: "hello" }],
    });
    const visible = await runAsTenant(actor(userA), () => listBotPosts(prisma, feedBot));
    expect(visible.map((post) => post.content)).toEqual(["published"]);
    expect(visible[0]?.artifacts.map((artifact) => artifact.name)).toEqual(["note.txt"]);
    await expect(
      runAsTenant(actor(userA), () => ensureUserThread(prisma, actor(userA), feedBot)),
    ).rejects.toBeInstanceOf(IsolationError);
    const hidden = await runAsTenant(actor(outsider), () =>
      prisma.botPost.findMany({ where: { botId: feedBot } }),
    );
    expect(hidden).toEqual([]);
    const threads = await runAsSystem("hive feed threads", () =>
      prisma.thread.findMany({ where: { botId: feedBot, routineId: null } }),
    );
    expect(threads).toEqual([]);
    await runAsSystem("hive feed cleanup", async () => {
      await prisma.botPost.deleteMany({ where: { botId: feedBot } });
      await prisma.user.deleteMany({ where: { id: outsider } });
    });
  });

  it("creates a super admin with the organization and keeps a later member a user", async () => {
    const founderId = `f${suffix}`;
    const joinerId = `j${suffix}`;
    await runAsSystem("hive signup users", async () => {
      await prisma.user.create({
        data: { id: founderId, name: "Founder", email: `${founderId}@example.com`, emailVerified: true },
      });
      await prisma.user.create({
        data: { id: joinerId, name: "Joiner", email: `${joinerId}@example.com`, emailVerified: true },
      });
    });
    const { spaceId: founded } = await bootstrapUserSpace(
      prisma,
      { id: founderId },
      { signupsEnabled: "true", signupAllowlist: "" },
    );
    const founder = await runAsSystem("hive founder role", () =>
      prisma.hiveRole.findUnique({
        where: { organizationId_userId: { organizationId: founded, userId: founderId } },
      }),
    );
    expect(founder?.role).toBe("SUPER_ADMIN");
    const todos = await runAsSystem("hive founder todos", () =>
      prisma.department.findFirst({
        where: { organizationId: founded, system: true },
        select: { id: true, name: true },
      }),
    );
    expect(todos?.name).toBe("Todos");
    const founderMembership = await runAsSystem("hive founder area", () =>
      prisma.departmentMember.findUnique({
        where: { departmentId_userId: { departmentId: todos!.id, userId: founderId } },
      }),
    );
    expect(founderMembership).not.toBeNull();
    await runAsSystem("hive join", async () => {
      await prisma.member.create({
        data: {
          id: `member-${joinerId}`,
          organizationId: founded,
          userId: joinerId,
          role: "member",
          createdAt: new Date(),
        },
      });
    });
    const joined = await ensureMemberRole(prisma, { userId: joinerId, spaceId: founded });
    expect(joined?.role).toBe("USER");
    const joinerMembership = await runAsSystem("hive joiner area", () =>
      prisma.departmentMember.findUnique({
        where: { departmentId_userId: { departmentId: todos!.id, userId: joinerId } },
      }),
    );
    expect(joinerMembership).not.toBeNull();
    await runAsSystem("hive signup cleanup", async () => {
      await prisma.organization.deleteMany({ where: { id: founded } });
      await prisma.user.deleteMany({ where: { id: { in: [founderId, joinerId] } } });
    });
  });
});
