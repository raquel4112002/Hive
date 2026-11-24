-- Hive modification: one SSO configuration per organization. Adding tables is safe for the previous release.

CREATE TABLE "hive_sso" (
    "organizationId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "secretRef" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "passwordLogin" BOOLEAN NOT NULL DEFAULT true,
    "groupMap" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hive_sso_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "hive_sso_subjects" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hive_sso_subjects_pkey" PRIMARY KEY ("organizationId", "subject")
);
CREATE INDEX "hive_sso_subjects_userId_idx" ON "hive_sso_subjects"("userId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "hive_sso", "hive_sso_subjects" TO rakazo_app;

ALTER TABLE "hive_sso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_sso" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hive_sso_subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_sso_subjects" FORCE ROW LEVEL SECURITY;

CREATE POLICY "hive_sso_system" ON "hive_sso"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "hive_sso_subjects_system" ON "hive_sso_subjects"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
