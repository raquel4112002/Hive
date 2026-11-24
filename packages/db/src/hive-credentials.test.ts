import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { saveHiveCredentialRef } from "./hive-credentials.js";

describe("hive credential metadata", () => {
  it("records who changed a credential and leaves the value out", async () => {
    const events: Array<{ action: string; actorUserId: string | null }> = [];
    const prisma = {
      hiveBotCredential: {
        findUnique: async () => null,
        create: async ({ data }: { data: { label: string; secretRef: string } }) => ({
          id: "cred-1",
          kind: "email",
          label: data.label,
          updatedAt: new Date("2026-11-24T00:00:00.000Z"),
          secretRef: data.secretRef,
        }),
      },
      hiveCredentialEvent: {
        create: async ({ data }: { data: { action: string; actorUserId: string | null } }) => {
          events.push(data);
          return data;
        },
      },
    };
    const saved = await saveHiveCredentialRef(prisma as unknown as PrismaClient, {
      organizationId: "org-1",
      botId: "bot-1",
      kind: "email",
      label: "Inbox",
      secretRef: "openbao:v1:org/org-1/bot/bot-1/inbox",
      actorUserId: "admin-1",
    });
    expect(saved).toEqual({
      id: "cred-1",
      kind: "email",
      label: "Inbox",
      set: true,
      updatedAt: "2026-11-24T00:00:00.000Z",
    });
    expect(JSON.stringify(saved)).not.toContain("mailbox");
    expect(events).toEqual([
      expect.objectContaining({ action: "created", actorUserId: "admin-1" }),
    ]);
    expect(JSON.stringify(events)).not.toContain("mailbox");
  });
});
