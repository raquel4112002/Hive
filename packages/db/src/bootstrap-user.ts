import { randomBytes } from "node:crypto";
import { signupPolicyFromEnv } from "@rakazo/core";
import type { PrismaClient } from "./client.js";
import type { Prisma } from "./generated/prisma/client.js";
import { runAsSystemInTransaction } from "./row-security.js";

const EVERYONE_DEPARTMENT_NAME = "Todos";

export interface SignupPolicyEnv {
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/** Provision a personal workspace. Signup never grants deployment administration. */
export async function bootstrapUserSpace(
  prisma: PrismaClient,
  user: { id: string },
  env: SignupPolicyEnv,
): Promise<{ spaceId: string }> {
  // The organization, its founding member, and that member's Hive role commit together.
  return prisma.$transaction(async (tx) => {
    // Concurrent bootstraps for the same user (e.g. overlapping first phone
    // inbounds) race on every unique key below; each step either wins or
    // joins the winner's state instead of failing.
    const slug = `user-${user.id.slice(0, 12)}`;
    let orgId = newId();
    try {
      await tx.organization.create({
        data: { id: orgId, name: "Personal", slug, createdAt: new Date() },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      orgId = (await tx.organization.findUniqueOrThrow({ where: { slug } })).id;
    }
    await tx.member
      .create({
        data: {
          id: newId(),
          organizationId: orgId,
          userId: user.id,
          role: "owner",
          createdAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
    await tx.space
      .create({
        data: {
          id: orgId,
          organizationId: orgId,
          name: "Personal",
          isDefault: true,
          createdByUserId: user.id,
          createdAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
    await tx.spaceMember
      .create({
        data: {
          id: newId(),
          spaceId: orgId,
          organizationId: orgId,
          userId: user.id,
          role: "owner",
          createdAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
    const policy = signupPolicyFromEnv(env);
    await tx.deploymentSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        ownerUserId: null,
        signupsEnabled: policy.enabled,
        signupAllowlist: policy.allowlist.join(","),
        signupPolicyInitialized: true,
      },
      update: {},
    });
    await runAsSystemInTransaction(tx, "hive founder", async () => {
      const hasMemory = await tx.memoryDocument.findFirst({
        where: { spaceId: orgId, userId: user.id, scope: "user", path: "MEMORY.md" },
      });
      if (!hasMemory) {
        await tx.memoryDocument
          .create({
            data: {
              spaceId: orgId,
              userId: user.id,
              scope: "user",
              path: "MEMORY.md",
              content:
                "# Space memory\n\nPreferences and context kept within this space live here.\n",
            },
          })
          .catch((error: unknown) => {
            if (!isUniqueViolation(error)) throw error;
          });
      }
      await tx.notificationPreference
        .create({
          data: {
            spaceId: orgId,
            userId: user.id,
          },
        })
        .catch((error: unknown) => {
          if (!isUniqueViolation(error)) throw error;
        });
      await seedFounderHive(tx, orgId, user.id);
    });
    return { spaceId: orgId };
  });
}

/**
 * The person who creates the organization is its super admin and a member of Todos.
 * Someone who arrives after a super admin already exists stays a user.
 */
async function seedFounderHive(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const existing = await tx.hiveRole.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!existing) {
    const supers = await tx.hiveRole.count({
      where: { organizationId, role: "SUPER_ADMIN" },
    });
    await tx.hiveRole.create({
      data: { organizationId, userId, role: supers > 0 ? "USER" : "SUPER_ADMIN" },
    });
  }
  const department = await tx.department.findFirst({
    where: { organizationId, system: true },
    select: { id: true },
  });
  const departmentId = department
    ? department.id
    : (
        await tx.department.create({
          data: {
            organizationId,
            name: EVERYONE_DEPARTMENT_NAME,
            system: true,
            createdByUserId: "",
          },
          select: { id: true },
        })
      ).id;
  await tx.departmentMember
    .create({ data: { departmentId, userId } })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
}
