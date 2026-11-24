import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { acceptHiveInvite, hivePublicSignupClosed } from "./hive-invite.js";
import type { PrismaClient } from "./client.js";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("hivePublicSignupClosed", () => {
  it("stays open for the first organization and when the flag is set", async () => {
    const previous = process.env.HIVE_ALLOW_SIGNUP;
    process.env.HIVE_ALLOW_SIGNUP = "false";
    const orgs = { n: 0 };
    const prisma = { organization: { count: async () => orgs.n } } as unknown as PrismaClient;
    expect(await hivePublicSignupClosed(prisma)).toBe(false);
    orgs.n = 1;
    expect(await hivePublicSignupClosed(prisma)).toBe(true);
    process.env.HIVE_ALLOW_SIGNUP = "true";
    expect(await hivePublicSignupClosed(prisma)).toBe(false);
    if (previous === undefined) delete process.env.HIVE_ALLOW_SIGNUP;
    else process.env.HIVE_ALLOW_SIGNUP = previous;
  });
});

describe("acceptHiveInvite", () => {
  it("creates a USER in the invited organization and refuses a second use", async () => {
    const token = "invite-token";
    const invite = {
      id: "inv-1",
      organizationId: "org-1",
      email: "invited@example.test",
      role: "USER",
      departmentIds: "dept-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null as Date | null,
    };
    const roles: Array<{ organizationId: string; userId: string; role: string }> = [];
    const members: Array<{ organizationId: string; userId: string; role: string }> = [];
    const areas: Array<{ departmentId: string; userId: string }> = [];
    const prisma = {
      hiveInvite: {
        findUnique: async () => ({ ...invite }),
        updateMany: async () => {
          if (invite.usedAt) return { count: 0 };
          invite.usedAt = new Date();
          return { count: 1 };
        },
      },
      member: {
        create: async ({ data }: { data: { organizationId: string; userId: string; role: string } }) => {
          members.push(data);
          return data;
        },
      },
      spaceMember: {
        upsert: async ({
          where,
        }: {
          where: { spaceId_userId: { spaceId: string; userId: string } };
        }) => where,
      },
      hiveRole: {
        create: async ({ data }: { data: { organizationId: string; userId: string; role: string } }) => {
          roles.push(data);
          return data;
        },
        findMany: async () => roles,
      },
      departmentMember: {
        create: async ({ data }: { data: { departmentId: string; userId: string } }) => {
          areas.push(data);
          return data;
        },
        createMany: async () => ({ count: 0 }),
        upsert: async ({ create }: { create: { departmentId: string; userId: string } }) => {
          areas.push(create);
          return create;
        },
      },
      department: {
        findFirst: async () => ({ id: "todos" }),
      },
      notificationPreference: { create: async () => ({}) },
    };
    const user = { id: "user-2", email: "Invited@example.test" };
    const joined = await acceptHiveInvite(prisma as unknown as PrismaClient, user, token);
    expect(joined.spaceId).toBe("org-1");
    expect(members).toEqual([
      expect.objectContaining({ organizationId: "org-1", userId: "user-2", role: "member" }),
    ]);
    expect(roles).toEqual([{ organizationId: "org-1", userId: "user-2", role: "USER" }]);
    expect(prisma.spaceMember.upsert).toBeDefined();
    expect(areas).toEqual(
      expect.arrayContaining([
        { departmentId: "dept-1", userId: "user-2" },
        { departmentId: "todos", userId: "user-2" },
      ]),
    );
    expect(hash(token)).toHaveLength(64);
    await expect(acceptHiveInvite(prisma as unknown as PrismaClient, user, token)).rejects.toThrow(
      "Resource not found",
    );
  });

  it("keeps an existing space membership for the same person and still fails other errors", async () => {
    const invite = {
      id: "inv-3",
      organizationId: "org-1",
      email: "invited@example.test",
      role: "USER",
      departmentIds: "dept-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null as Date | null,
    };
    const memberships: Array<{ spaceId: string; userId: string }> = [];
    const roles: Array<{ role: string }> = [];
    const prisma = {
      hiveInvite: {
        findUnique: async () => ({ ...invite }),
        updateMany: async () => {
          invite.usedAt = new Date();
          return { count: 1 };
        },
      },
      member: { create: async () => ({}) },
      spaceMember: {
        upsert: async ({
          where,
        }: {
          where: { spaceId_userId: { spaceId: string; userId: string } };
        }) => {
          memberships.push(where.spaceId_userId);
          return where.spaceId_userId;
        },
      },
      hiveRole: {
        create: async ({ data }: { data: { role: string } }) => {
          roles.push(data);
          return data;
        },
        findMany: async () => roles,
      },
      departmentMember: {
        create: async () => ({}),
        upsert: async () => ({}),
        createMany: async () => ({ count: 0 }),
      },
      department: { findFirst: async () => ({ id: "todos" }) },
      notificationPreference: { create: async () => ({}) },
    };
    const joined = await acceptHiveInvite(
      prisma as unknown as PrismaClient,
      { id: "user-3", email: "invited@example.test" },
      "invite-token",
    );
    expect(joined.spaceId).toBe("org-1");
    expect(memberships).toEqual([{ spaceId: "org-1", userId: "user-3" }]);
    expect(roles).toEqual([
      expect.objectContaining({ organizationId: "org-1", userId: "user-3", role: "USER" }),
    ]);
    prisma.member.create = async () => {
      throw Object.assign(new Error("organization missing"), { code: "P2003" });
    };
    invite.usedAt = null;
    await expect(
      acceptHiveInvite(prisma as unknown as PrismaClient, { id: "user-4", email: invite.email }, "invite-token"),
    ).rejects.toThrow("organization missing");
  });

  it("refuses an expired invite and a different email", async () => {
    const invite = {
      id: "inv-2",
      organizationId: "org-1",
      email: "invited@example.test",
      role: "USER",
      departmentIds: "",
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    };
    const prisma = {
      hiveInvite: { findUnique: async () => invite, updateMany: async () => ({ count: 1 }) },
    } as unknown as PrismaClient;
    await expect(
      acceptHiveInvite(prisma, { id: "user-2", email: "invited@example.test" }, "invite-token"),
    ).rejects.toThrow("Resource not found");
    invite.expiresAt = new Date(Date.now() + 60_000);
    await expect(
      acceptHiveInvite(prisma, { id: "user-2", email: "other@example.test" }, "invite-token"),
    ).rejects.toThrow("Resource not found");
  });
});
