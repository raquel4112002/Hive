// Hive modification: the model searches documents through one tool.
// Derived from Rakazo (Apache License 2.0).

import { KNOWLEDGE_NOT_FOUND, runKnowledgeSearch } from "./hive-knowledge.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";

export async function searchKnowledge(ctx: RunContext, call: ToolCall) {
  const query = typeof call.args.query === "string" ? call.args.query : "";
  try {
    return {
      text: await runKnowledgeSearch(ctx.deps.prisma, {
        botId: ctx.run.botId,
        botUserId: ctx.bot.userId,
        runUserId: ctx.run.userId,
        routineId: ctx.run.routineId,
        query,
      }),
    };
  } catch {
    return { text: KNOWLEDGE_NOT_FOUND };
  }
}
