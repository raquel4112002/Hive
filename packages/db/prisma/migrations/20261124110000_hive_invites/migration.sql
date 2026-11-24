-- Hive modification: one-time invitations into an existing organization.
-- Adding a table is safe for the previous release, which does not read it.

CREATE TABLE "hive_invites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "departmentIds" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hive_invites_tokenHash_key" ON "hive_invites"("tokenHash");

CREATE INDEX "hive_invites_organizationId_idx" ON "hive_invites"("organizationId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "hive_invites" TO rakazo_app;

ALTER TABLE "hive_invites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hive_invites_system" ON "hive_invites"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
