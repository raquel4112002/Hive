// Hive modification: organization connections and conversation inspect.
// Derived from Rakazo (Apache License 2.0).

import { ORPCError } from "@orpc/server";
import { createLiteLLM, hiveLiteLLM, issueBotModelKey, listBotSpend, vaultHealth, writeHiveCredential } from "@rakazo/adapters";
import {
  assignBotDepartment,
  createHiveInvite,
  ensureEveryoneDepartment,
  inspectConversation,
  linkBotConnection,
  listBotPosts,
  listHiveCredentials,
  readBotPostArtifact,
  readHiveRole,
  removeHiveCredential,
  IsolationError,
  runAsSystem,
  setBotPublication,
} from "@rakazo/db";
import type { RouterContext } from "./context.js";

function keyDeps(ctx: RouterContext) {
  return {
    prisma: ctx.deps.prisma,
    secretStore: ctx.deps.secrets,
    mcpAllowPrivateEndpoint: ctx.deps.env.mcpAllowPrivateEndpoint,
  };
}

async function requireHiveAdmin(ctx: RouterContext, userId: string, spaceId: string) {
  const hive = await readHiveRole(ctx.deps.prisma, { userId, spaceId });
  if (!hive || hive.archived || hive.role === "USER") throw new IsolationError();
  return hive;
}

export function hiveRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    hive: {
      linkConnection: authed.hive.linkConnection.handler(async ({ context, input }) => {
        await linkBotConnection(deps.prisma, context.actor, input.botId, input.connectionId);
        return { ok: true as const };
      }),
      assignDepartment: authed.hive.assignDepartment.handler(async ({ context, input }) => {
        const hive = await readHiveRole(deps.prisma, context.actor);
        if (!hive) throw new IsolationError();
        const departmentId = input.everyone
          ? await ensureEveryoneDepartment(deps.prisma, hive.organizationId)
          : input.departmentId;
        if (!departmentId) throw new IsolationError();
        await assignBotDepartment(
          deps.prisma,
          context.actor,
          input.botId,
          departmentId,
          input.accessLevel,
        );
        return { ok: true as const };
      }),
      setPublication: authed.hive.setPublication.handler(async ({ context, input }) => {
        await setBotPublication(deps.prisma, context.actor, input.botId, input.publication);
        return { ok: true as const };
      }),
      modelCatalog: authed.hive.modelCatalog.handler(async ({ context }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const litellm = hiveLiteLLM();
        if (!litellm) return { enabled: false, models: [] };
        return { enabled: true, models: await createLiteLLM(litellm).models() };
      }),
      departments: authed.hive.departments.handler(async ({ context }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return runAsSystem("hive departments", () =>
          deps.prisma.department.findMany({
            where: { organizationId: hive.organizationId },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
        );
      }),
      invite: authed.hive.invite.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const created = await createHiveInvite(deps.prisma, {
          organizationId: hive.organizationId,
          createdByUserId: context.actor.userId,
          email: input.email,
          role: input.role,
          departmentIds: input.departmentIds,
          webOrigin: deps.env.webOrigin,
        });
        return { link: created.link, expiresAt: created.expiresAt.toISOString() };
      }),
      setModel: authed.hive.setModel.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        try {
          await issueBotModelKey(keyDeps(ctx), {
            botId: input.botId,
            spaceId: context.actor.spaceId,
            orgId: hive.organizationId,
            model: input.model,
            monthlyBudget: input.monthlyBudget,
            modelKey: input.modelKey,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save the model key.";
          if (
            message === "LiteLLM is not configured." ||
            message === "Choose a model." ||
            message.startsWith("LiteLLM ")
          ) {
            throw new ORPCError("BAD_REQUEST", { message });
          }
          throw error;
        }
        return { ok: true as const };
      }),
      vaultStatus: authed.hive.vaultStatus.handler(async ({ context }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return { sealed: (await vaultHealth()) !== null };
      }),
      credentials: authed.hive.credentials.handler(async ({ context, input }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        return listHiveCredentials(deps.prisma, input.botId);
      }),
      saveCredential: authed.hive.saveCredential.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        return writeHiveCredential(deps.prisma, deps.secrets, {
          organizationId: hive.organizationId,
          botId: input.botId,
          kind: input.kind,
          label: input.label,
          value: input.value,
          actorUserId: context.actor.userId,
        });
      }),
      removeCredential: authed.hive.removeCredential.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        const secretRef = await removeHiveCredential(deps.prisma, {
          botId: input.botId,
          label: input.label,
          actorUserId: context.actor.userId,
          organizationId: hive.organizationId,
        });
        if (secretRef) await deps.secrets.delete(secretRef, `bot:${input.botId}`).catch(() => undefined);
        return { ok: true as const };
      }),
      spend: authed.hive.spend.handler(async ({ context, input }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const report = await listBotSpend(keyDeps(ctx), context.actor.spaceId, input.month);
        return { month: input.month, ...report };
      }),
      inspectConversation: authed.hive.inspectConversation.handler(async ({ context, input }) => {
        const opened = await inspectConversation(deps.prisma, context.actor, input);
        return {
          threadId: opened.threadId,
          expiresAt: opened.expiresAt.toISOString(),
          messages: opened.messages,
        };
      }),
    },
    posts: {
      list: authed.posts.list.handler(async ({ input }) => {
        const posts = await listBotPosts(deps.prisma, input.botId);
        return posts.map((post) => ({
          id: post.id,
          content: post.content,
          createdAt: post.createdAt.toISOString(),
          artifacts: post.artifacts,
        }));
      }),
      artifact: authed.posts.artifact.handler(async ({ input }) =>
        readBotPostArtifact(deps.prisma, input.artifactId),
      ),
    },
  };
}
