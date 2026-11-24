-- Hive modification: one encrypted LiteLLM key per bot.
-- Adding a table is safe for the previous release, which does not read it.

CREATE TABLE "bot_litellm_keys" (
    "botId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "keyAlias" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "budgetCents" INTEGER,
    "pasted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_litellm_keys_pkey" PRIMARY KEY ("botId")
);

CREATE INDEX "bot_litellm_keys_spaceId_idx" ON "bot_litellm_keys"("spaceId");

ALTER TABLE "bot_litellm_keys" ADD CONSTRAINT "bot_litellm_keys_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "bot_litellm_keys" TO rakazo_app;

ALTER TABLE "bot_litellm_keys" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bot_litellm_keys_system" ON "bot_litellm_keys"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
