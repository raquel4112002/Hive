-- Hive modification: roles, assignments, private threads, and service accounts.
-- Derived from Rakazo (Apache License 2.0).
-- Additive. The previous release keeps its policies while app.rls_version is below 3.

ALTER TABLE "user" ADD COLUMN "hiveService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "hiveArchivedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "hiveDeleteAfter" TIMESTAMP(3);

ALTER TABLE "deployment_settings" ADD COLUMN "personRemovalMode" TEXT NOT NULL DEFAULT 'archive';
ALTER TABLE "deployment_settings" ADD COLUMN "personArchiveDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "threads" ADD COLUMN "routineId" TEXT;

CREATE TABLE "hive_roles" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hive_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hive_roles_organizationId_userId_key" ON "hive_roles"("organizationId", "userId");
CREATE INDEX "hive_roles_userId_idx" ON "hive_roles"("userId");

CREATE TABLE "departments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "departments_organizationId_name_key" ON "departments"("organizationId", "name");

CREATE TABLE "department_members" (
  "id" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "department_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "department_members_departmentId_userId_key" ON "department_members"("departmentId", "userId");
CREATE INDEX "department_members_userId_idx" ON "department_members"("userId");

CREATE TABLE "bot_assignments" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_assignments_botId_userId_key" ON "bot_assignments"("botId", "userId");
CREATE INDEX "bot_assignments_userId_idx" ON "bot_assignments"("userId");

CREATE TABLE "bot_department_assignments" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_department_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_department_assignments_botId_departmentId_key" ON "bot_department_assignments"("botId", "departmentId");

CREATE TABLE "bot_connections" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_connections_botId_connectionId_key" ON "bot_connections"("botId", "connectionId");

CREATE TABLE "routine_recipients" (
  "id" TEXT NOT NULL,
  "routineId" TEXT NOT NULL,
  "userId" TEXT,
  "departmentId" TEXT,
  CONSTRAINT "routine_recipients_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "routine_recipients_routineId_idx" ON "routine_recipients"("routineId");

CREATE TABLE "bot_user_computers" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "computerId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'stopped',
  "lastActiveAt" TIMESTAMP(3),
  "queuedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bot_user_computers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_user_computers_botId_userId_key" ON "bot_user_computers"("botId", "userId");
CREATE INDEX "bot_user_computers_state_queuedAt_idx" ON "bot_user_computers"("state", "queuedAt");

CREATE TABLE "conversation_grants" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conversation_grants_threadId_actorUserId_idx" ON "conversation_grants"("threadId", "actorUserId");

CREATE INDEX "threads_routineId_idx" ON "threads"("routineId");
CREATE UNIQUE INDEX "threads_bot_user_key" ON "threads"("botId", "userId")
  WHERE "botId" IS NOT NULL AND "routineId" IS NULL;
CREATE UNIQUE INDEX "threads_routine_key" ON "threads"("routineId")
  WHERE "routineId" IS NOT NULL;
CREATE UNIQUE INDEX "memory_documents_space_scope_bot_path_user_key"
  ON "memory_documents"("spaceId", "scope", "botId", "path", "userId");

INSERT INTO "user" ("id", "name", "email", "emailVerified", "hiveService", "createdAt", "updatedAt")
SELECT
  'hive-service-' || o."id",
  'Service',
  'service+' || o."id" || '@hive.invalid',
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "user" existing WHERE existing."id" = 'hive-service-' || o."id"
);

INSERT INTO "bot_assignments" ("id", "botId", "userId", "assignedByUserId", "createdAt")
SELECT
  'hive-asg-' || b."id",
  b."id",
  b."userId",
  b."userId",
  CURRENT_TIMESTAMP
FROM "bots" b
WHERE NOT EXISTS (
  SELECT 1 FROM "bot_assignments" a WHERE a."botId" = b."id" AND a."userId" = b."userId"
);

UPDATE "bots" b
SET "userId" = 'hive-service-' || s."organizationId"
FROM "spaces" s
WHERE b."spaceId" = s."id";

UPDATE "computers" c
SET "userId" = b."userId"
FROM "bots" b
WHERE b."computerId" = c."id";

INSERT INTO "hive_roles" ("id", "organizationId", "userId", "role", "createdAt")
SELECT
  'hive-role-' || m."id",
  m."organizationId",
  m."userId",
  CASE
    WHEN m."role" = 'owner' AND m."id" = (
      SELECT m2."id" FROM "member" m2
      WHERE m2."organizationId" = m."organizationId" AND m2."role" = 'owner'
      ORDER BY m2."createdAt" ASC, m2."id" ASC
      LIMIT 1
    ) THEN 'SUPER_ADMIN'
    WHEN m."role" = 'owner' THEN 'ADMIN'
    ELSE 'USER'
  END,
  CURRENT_TIMESTAMP
FROM "member" m
WHERE NOT EXISTS (
  SELECT 1 FROM "hive_roles" r
  WHERE r."organizationId" = m."organizationId" AND r."userId" = m."userId"
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "hive_roles",
  "departments",
  "department_members",
  "bot_assignments",
  "bot_department_assignments",
  "bot_connections",
  "routine_recipients",
  "bot_user_computers",
  "conversation_grants"
TO rakazo_app;

CREATE OR REPLACE FUNCTION app_space_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.space_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION hive_org_enabled() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM "hive_roles" r
      JOIN "spaces" s ON s."organizationId" = r."organizationId"
      WHERE s."id" = app_space_id()
    )
  $$;

CREATE OR REPLACE FUNCTION hive_admin_here() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM "hive_roles" r
      JOIN "spaces" s ON s."organizationId" = r."organizationId"
      WHERE r."userId" = app_user_id()
        AND r."role" IN ('ADMIN', 'SUPER_ADMIN')
        AND s."id" = app_space_id()
        AND NOT EXISTS (
          SELECT 1 FROM "user" u
          WHERE u."id" = r."userId" AND u."hiveArchivedAt" IS NOT NULL
        )
    )
  $$;

CREATE OR REPLACE FUNCTION hive_bot_visible(bot_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM "bot_assignments" a
      WHERE a."botId" = bot_id AND a."userId" = app_user_id()
    ) OR EXISTS (
      SELECT 1 FROM "bot_department_assignments" a
      JOIN "department_members" m ON m."departmentId" = a."departmentId"
      WHERE a."botId" = bot_id AND m."userId" = app_user_id()
    )
  $$;

GRANT EXECUTE ON FUNCTION app_space_id() TO rakazo_app;
GRANT EXECUTE ON FUNCTION app_user_id() TO rakazo_app;
GRANT EXECUTE ON FUNCTION hive_org_enabled() TO rakazo_app;
GRANT EXECUTE ON FUNCTION hive_admin_here() TO rakazo_app;
GRANT EXECUTE ON FUNCTION hive_bot_visible(text) TO rakazo_app;

ALTER POLICY "threads_tenant" ON "threads"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "messages_tenant" ON "messages"
  USING (
    app_rls_version() < 3
    AND EXISTS (
      SELECT 1 FROM "threads" t
      WHERE t."id" = "messages"."threadId"
        AND t."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
  )
  WITH CHECK (
    app_rls_version() < 3
    AND EXISTS (
      SELECT 1 FROM "threads" t
      WHERE t."id" = "messages"."threadId"
        AND t."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
  );

ALTER POLICY "memory_documents_tenant" ON "memory_documents"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "memory_revisions_tenant" ON "memory_revisions"
  USING (
    app_rls_version() < 3
    AND EXISTS (
      SELECT 1 FROM "memory_documents" d
      WHERE d."id" = "memory_revisions"."documentId"
        AND d."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
  )
  WITH CHECK (
    app_rls_version() < 3
    AND EXISTS (
      SELECT 1 FROM "memory_documents" d
      WHERE d."id" = "memory_revisions"."documentId"
        AND d."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
  );

ALTER POLICY "artifacts_tenant" ON "artifacts"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "bots_tenant" ON "bots"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "routines_tenant" ON "routines"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "connections_tenant" ON "connections"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "bot_secrets_tenant" ON "bot_secrets"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "usage_records_tenant" ON "usage_records"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

ALTER POLICY "scratchpad_items_tenant" ON "scratchpad_items"
  USING (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  )
  WITH CHECK (
    app_rls_version() < 3
    AND "spaceId" = NULLIF(current_setting('app.space_id', true), '')
  );

CREATE POLICY "threads_hive" ON "threads"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR (
        "userId" = app_user_id()
        AND "routineId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "user" u
          WHERE u."id" = "threads"."userId" AND u."hiveArchivedAt" IS NOT NULL
        )
      )
      OR ("routineId" IS NOT NULL AND hive_admin_here())
      OR EXISTS (
        SELECT 1 FROM "conversation_grants" g
        WHERE g."threadId" = "threads"."id"
          AND g."actorUserId" = app_user_id()
          AND g."expiresAt" > CURRENT_TIMESTAMP
      )
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR "userId" = app_user_id()
      OR (hive_admin_here() AND "routineId" IS NOT NULL)
    )
  );

CREATE POLICY "messages_hive" ON "messages"
  USING (
    app_rls_version() >= 3
    AND EXISTS (
      SELECT 1 FROM "threads" t
      WHERE t."id" = "messages"."threadId"
        AND t."spaceId" = app_space_id()
        AND (
          NOT hive_org_enabled()
          OR (
            t."userId" = app_user_id()
            AND NOT EXISTS (
              SELECT 1 FROM "user" u
              WHERE u."id" = t."userId" AND u."hiveArchivedAt" IS NOT NULL
            )
          )
          OR EXISTS (
            SELECT 1 FROM "conversation_grants" g
            WHERE g."threadId" = t."id"
              AND g."actorUserId" = app_user_id()
              AND g."expiresAt" > CURRENT_TIMESTAMP
          )
        )
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND EXISTS (
      SELECT 1 FROM "threads" t
      WHERE t."id" = "messages"."threadId"
        AND t."spaceId" = app_space_id()
        AND (NOT hive_org_enabled() OR t."userId" = app_user_id())
    )
  );

CREATE POLICY "memory_documents_hive" ON "memory_documents"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR (
        "userId" = app_user_id()
        AND NOT EXISTS (
          SELECT 1 FROM "user" u
          WHERE u."id" = "memory_documents"."userId" AND u."hiveArchivedAt" IS NOT NULL
        )
      )
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (NOT hive_org_enabled() OR "userId" = app_user_id())
  );

CREATE POLICY "artifacts_hive" ON "artifacts"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR (
        "userId" = app_user_id()
        AND NOT EXISTS (
          SELECT 1 FROM "user" u
          WHERE u."id" = "artifacts"."userId" AND u."hiveArchivedAt" IS NOT NULL
        )
      )
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (NOT hive_org_enabled() OR "userId" = app_user_id())
  );

CREATE POLICY "scratchpad_items_hive" ON "scratchpad_items"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR (
        "userId" = app_user_id()
        AND NOT EXISTS (
          SELECT 1 FROM "user" u
          WHERE u."id" = "scratchpad_items"."userId" AND u."hiveArchivedAt" IS NOT NULL
        )
      )
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (NOT hive_org_enabled() OR "userId" = app_user_id())
  );

CREATE POLICY "bots_hive_select" ON "bots" FOR SELECT
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR "userId" = app_user_id()
      OR hive_bot_visible("id")
      OR hive_admin_here()
    )
  );

CREATE POLICY "bots_hive_insert" ON "bots" FOR INSERT
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (hive_admin_here() OR NOT hive_org_enabled())
  );

CREATE POLICY "bots_hive_update" ON "bots" FOR UPDATE
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (hive_admin_here() OR NOT hive_org_enabled())
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (hive_admin_here() OR NOT hive_org_enabled())
  );

CREATE POLICY "bots_hive_delete" ON "bots" FOR DELETE
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (hive_admin_here() OR NOT hive_org_enabled())
  );

CREATE POLICY "routines_hive" ON "routines"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR hive_admin_here()
      OR hive_bot_visible("botId")
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (hive_admin_here() OR NOT hive_org_enabled())
  );

CREATE POLICY "connections_hive" ON "connections"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR "userId" = app_user_id()
      OR hive_admin_here()
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR "userId" = app_user_id()
      OR hive_admin_here()
    )
  );

CREATE POLICY "bot_secrets_hive" ON "bot_secrets"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (NOT hive_org_enabled() OR hive_admin_here())
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (NOT hive_org_enabled() OR hive_admin_here())
  );

CREATE POLICY "usage_records_hive" ON "usage_records"
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR "userId" = app_user_id()
      OR hive_admin_here()
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR "userId" = app_user_id()
      OR hive_admin_here()
    )
  );

DO $$
DECLARE
  protected text;
BEGIN
  FOREACH protected IN ARRAY ARRAY[
    'hive_roles', 'departments', 'department_members', 'bot_assignments',
    'bot_department_assignments', 'bot_connections', 'routine_recipients',
    'bot_user_computers', 'conversation_grants'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', protected);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (current_setting(''app.rls_bypass'', true) = ''on'')',
      protected || '_system', protected);
  END LOOP;
END $$;

CREATE POLICY "hive_roles_read" ON "hive_roles" FOR SELECT
  USING (app_rls_version() >= 3 AND "userId" = app_user_id());

CREATE POLICY "bot_assignments_read" ON "bot_assignments" FOR SELECT
  USING (
    app_rls_version() >= 3
    AND (
      "userId" = app_user_id()
      OR (
        hive_admin_here()
        AND EXISTS (
          SELECT 1 FROM "bots" b
          JOIN "spaces" s ON s."id" = b."spaceId"
          WHERE b."id" = "bot_assignments"."botId"
            AND s."id" = app_space_id()
        )
      )
    )
  );

CREATE POLICY "department_members_read" ON "department_members" FOR SELECT
  USING (
    app_rls_version() >= 3
    AND (
      "userId" = app_user_id()
      OR EXISTS (
        SELECT 1 FROM "departments" d
        JOIN "hive_roles" r ON r."organizationId" = d."organizationId"
        WHERE d."id" = "department_members"."departmentId"
          AND r."userId" = app_user_id()
          AND r."role" IN ('ADMIN', 'SUPER_ADMIN')
      )
    )
  );

CREATE POLICY "bot_department_assignments_read" ON "bot_department_assignments" FOR SELECT
  USING (
    app_rls_version() >= 3
    AND (
      EXISTS (
        SELECT 1 FROM "department_members" m
        WHERE m."departmentId" = "bot_department_assignments"."departmentId"
          AND m."userId" = app_user_id()
      )
      OR hive_admin_here()
    )
  );

CREATE POLICY "conversation_grants_actor" ON "conversation_grants"
  USING (app_rls_version() >= 3 AND "actorUserId" = app_user_id())
  WITH CHECK (
    app_rls_version() >= 3
    AND "actorUserId" = app_user_id()
    AND EXISTS (
      SELECT 1 FROM "hive_roles" r
      JOIN "spaces" s ON s."organizationId" = r."organizationId"
      WHERE r."userId" = app_user_id()
        AND r."role" = 'SUPER_ADMIN'
        AND s."id" = app_space_id()
    )
  );
