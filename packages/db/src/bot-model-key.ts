import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

export type BotModelKeyRow = {
  botId: string;
  spaceId: string;
  keyAlias: string;
  ciphertext: string;
  model: string;
  budgetCents: number | null;
  pasted: boolean;
};

function keys(prisma: PrismaClient) {
  return prisma.botLiteLLMKey;
}

export async function readBotModelKey(
  prisma: PrismaClient,
  botId: string,
): Promise<BotModelKeyRow | null> {
  if (typeof keys(prisma)?.findUnique !== "function") return null;
  return runAsSystem("hive bot model key", () =>
    keys(prisma).findUnique({
      where: { botId },
      select: {
        botId: true,
        spaceId: true,
        keyAlias: true,
        ciphertext: true,
        model: true,
        budgetCents: true,
        pasted: true,
      },
    }),
  );
}

export async function saveBotModelKey(
  prisma: PrismaClient,
  row: BotModelKeyRow,
): Promise<void> {
  if (typeof keys(prisma)?.upsert !== "function") return;
  await runAsSystem("hive bot model key", () =>
    keys(prisma).upsert({
      where: { botId: row.botId },
      create: row,
      update: {
        keyAlias: row.keyAlias,
        ciphertext: row.ciphertext,
        model: row.model,
        budgetCents: row.budgetCents,
        pasted: row.pasted,
      },
    }),
  );
}

export async function deleteBotModelKey(prisma: PrismaClient, botId: string): Promise<void> {
  if (typeof keys(prisma)?.deleteMany !== "function") return;
  await runAsSystem("hive bot model key", () => keys(prisma).deleteMany({ where: { botId } }));
}
