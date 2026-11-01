// Hive modification: organization connections and conversation inspect.
// Derived from Rakazo (Apache License 2.0).

import { inspectConversation, linkBotConnection } from "@rakazo/db";
import type { RouterContext } from "./context.js";

export function hiveRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    hive: {
      linkConnection: authed.hive.linkConnection.handler(async ({ context, input }) => {
        await linkBotConnection(deps.prisma, context.actor, input.botId, input.connectionId);
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
  };
}
