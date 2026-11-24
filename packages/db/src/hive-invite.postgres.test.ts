import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { acceptHiveInvite, createHiveInvite } from "./hive-invite.js";
import { runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("hive invite acceptance", () => {
  const suffix = randomBytes(4).toString("hex");
  const organizationId = `invite-org-${suffix}`;
  const founderId = `invite-founder-${suffix}`;
  const personId = `invite-person-${suffix}`;
  const email = `invite-${suffix}@example.com`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    await runAsSystem("invite fixture", async () => {
      await prisma.organization.create({
        data: { id: organizationId, name: "Invite", slug: organizationId, createdAt: new Date() },
      });
      await prisma.user.create({
        data: { id: founderId, name: "Founder", email: `founder-${suffix}@example.com`, emailVerified: true },
      });
      await prisma.space.create({
        data: { id: organizationId, organizationId, name: "Personal", isDefault: true },
      });
      await prisma.member.create({
        data: {
          id: `member-${founderId}`,
          organizationId,
          userId: founderId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      await prisma.hiveRole.create({
        data: { organizationId, userId: founderId, role: "SUPER_ADMIN" },
      });
    });
  });

  afterAll(async () => {
    if (prisma) {
      await runAsSystem("invite cleanup", async () => {
        const departments = await prisma.department.findMany({
          where: { organizationId },
          select: { id: true },
        });
        await prisma.hiveInvite.deleteMany({ where: { organizationId } });
        await prisma.hiveRole.deleteMany({ where: { organizationId } });
        await prisma.departmentMember.deleteMany({
          where: { departmentId: { in: departments.map((row) => row.id) } },
        });
        await prisma.department.deleteMany({ where: { organizationId } });
        await prisma.notificationPreference.deleteMany({ where: { spaceId: organizationId } });
        await prisma.organization.deleteMany({ where: { id: organizationId } });
        await prisma.user.deleteMany({ where: { id: { in: [founderId, personId] } } });
      });
    }
    await close?.();
  });

  it("accepts a fresh invite as USER in Todos without an error", async () => {
    const department = await runAsSystem("invite todos", () =>
      prisma.department.create({
        data: { organizationId, name: "Todos", system: true, createdByUserId: founderId },
      }),
    );
    const invite = await createHiveInvite(prisma, {
      organizationId,
      createdByUserId: founderId,
      email,
      role: "USER",
      departmentIds: [department.id],
      webOrigin: "http://127.0.0.1:5173",
    });
    const token = new URL(invite.link).searchParams.get("invite");
    expect(token).toBeTruthy();
    await runAsSystem("invite person", () =>
      prisma.user.create({
        data: { id: personId, name: "Invited", email, emailVerified: true },
      }),
    );
    const joined = await acceptHiveInvite(prisma, { id: personId, email }, token!);
    expect(joined.spaceId).toBe(organizationId);
    const role = await runAsSystem("invite role", () =>
      prisma.hiveRole.findUnique({
        where: { organizationId_userId: { organizationId, userId: personId } },
      }),
    );
    expect(role?.role).toBe("USER");
    const areas = await runAsSystem("invite areas", () =>
      prisma.departmentMember.findMany({
        where: { userId: personId, departmentId: department.id },
      }),
    );
    expect(areas).toHaveLength(1);
  });
});
