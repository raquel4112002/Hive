import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { maskCredentialText, sealedVaultRunError, vaultHealth } from "./hive-bot-vault.js";
import { OPENBAO_REF_PREFIX } from "./openbao-secret-store.js";

const openBao = {
  SECRET_STORE: "openbao",
  OPENBAO_ADDR: "http://openbao.test",
  OPENBAO_TOKEN: "fake",
};

function database(secretRef: string | null): PrismaClient {
  return {
    hiveBotCredential: {
      findMany: async () =>
        secretRef
          ? [{ id: "cred", organizationId: "org", label: "Inbox", kind: "email", secretRef }]
          : [],
    },
    botLiteLLMKey: { findUnique: async () => null },
    botSecret: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

describe("credential masking", () => {
  it("hides a secret the model tries to repeat", () => {
    const secret = "mailbox-password";
    expect(maskCredentialText(`The inbox password is ${secret}.`, [secret])).toBe(
      "The inbox password is [redacted].",
    );
  });
});

describe("sealed vault", () => {
  it("stops a run that needs a credential and leaves a run with nothing in the vault", async () => {
    const sealed = async () => Response.json({ sealed: true });
    const open = async () => Response.json({ sealed: false });
    expect(await vaultHealth(openBao, sealed)).toBe("cofre selado");
    expect(await vaultHealth({ SECRET_STORE: "encrypted" }, sealed)).toBeNull();
    expect(
      await sealedVaultRunError(database(`${OPENBAO_REF_PREFIX}org/o/bot/a/email`), "bot-a", openBao, sealed),
    ).toBe("cofre selado");
    expect(await sealedVaultRunError(database(null), "bot-a", openBao, sealed)).toBeNull();
    expect(
      await sealedVaultRunError(database(`${OPENBAO_REF_PREFIX}org/o/bot/a/email`), "bot-a", openBao, open),
    ).toBeNull();
  });
});
