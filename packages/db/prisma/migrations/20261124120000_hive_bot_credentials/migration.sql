-- Hive modification: metadata for per-bot credentials. The value is not stored here.
-- Adding tables is safe for the previous release, which does not read them.

CREATE TABLE "hive_bot_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_bot_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hive_bot_credentials_botId_label_key" ON "hive_bot_credentials"("botId", "label");
CREATE INDEX "hive_bot_credentials_organizationId_idx" ON "hive_bot_credentials"("organizationId");

CREATE TABLE "hive_credential_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "credentialId" TEXT,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_credential_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hive_credential_events_botId_createdAt_idx" ON "hive_credential_events"("botId", "createdAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON "hive_bot_credentials" TO rakazo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "hive_credential_events" TO rakazo_app;

ALTER TABLE "hive_bot_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_credential_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hive_bot_credentials_system" ON "hive_bot_credentials"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "hive_credential_events_system" ON "hive_credential_events"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
