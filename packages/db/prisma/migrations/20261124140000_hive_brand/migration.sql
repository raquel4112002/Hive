-- Hive modification: the organization's visible brand. Adding tables is safe for the previous release.

CREATE TABLE "hive_brands" (
    "organizationId" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT '',
    "logoLightKey" TEXT,
    "logoDarkKey" TEXT,
    "faviconKey" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "loginText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hive_brands_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "hive_bot_avatars" (
    "botId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hive_bot_avatars_pkey" PRIMARY KEY ("botId")
);
CREATE INDEX "hive_bot_avatars_organizationId_idx" ON "hive_bot_avatars"("organizationId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "hive_brands", "hive_bot_avatars" TO rakazo_app;

ALTER TABLE "hive_brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_brands" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hive_bot_avatars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_bot_avatars" FORCE ROW LEVEL SECURITY;

CREATE POLICY "hive_brands_system" ON "hive_brands"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "hive_bot_avatars_system" ON "hive_bot_avatars"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
