// Hive modification: organization connections and conversation inspect.
// Derived from Rakazo (Apache License 2.0).

import {
  assignBotDepartment,
  ensureEveryoneDepartment,
  inspectConversation,
  linkBotConnection,
  listBotPosts,
  readBotPostArtifact,
  readHiveRole,
  IsolationError,
  setBotPublication,
} from "@rakazo/db";
import type { RouterContext } from "./context.js";

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
