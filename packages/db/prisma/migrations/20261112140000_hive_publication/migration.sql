-- Hive modification: Todos, access level, and publication feed.
-- Derived from Rakazo (Apache License 2.0).

ALTER TABLE "departments" ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bot_assignments" ADD COLUMN "accessLevel" TEXT NOT NULL DEFAULT 'CHAT';
ALTER TABLE "bot_department_assignments" ADD COLUMN "accessLevel" TEXT NOT NULL DEFAULT 'CHAT';
ALTER TABLE "bots" ADD COLUMN "publication" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "bot_posts" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "routineRunId" TEXT,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_posts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bot_posts_botId_createdAt_idx" ON "bot_posts"("botId", "createdAt");

CREATE TABLE "bot_post_artifacts" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_post_artifacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bot_post_artifacts_postId_idx" ON "bot_post_artifacts"("postId");
ALTER TABLE "bot_post_artifacts"
  ADD CONSTRAINT "bot_post_artifacts_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "bot_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "departments"
SET "name" = "name" || ' (2)'
WHERE "name" = 'Todos' AND "system" = false;

INSERT INTO "departments" ("id", "organizationId", "name", "system", "createdByUserId", "createdAt")
SELECT 'hive-everyone-' || r."organizationId", r."organizationId", 'Todos', true, '', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "organizationId" FROM "hive_roles") r
WHERE NOT EXISTS (
  SELECT 1 FROM "departments" d
  WHERE d."organizationId" = r."organizationId" AND d."system" = true
);

INSERT INTO "department_members" ("id", "departmentId", "userId")
SELECT 'hive-everyone-' || h."organizationId" || '-' || h."userId",
       'hive-everyone-' || h."organizationId",
       h."userId"
FROM "hive_roles" h
JOIN "user" u ON u."id" = h."userId"
WHERE u."hiveArchivedAt" IS NULL AND u."hiveService" = false
ON CONFLICT ("departmentId", "userId") DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON "bot_posts", "bot_post_artifacts" TO rakazo_app;

CREATE OR REPLACE FUNCTION hive_may_chat(bot_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT bot_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "bots" b WHERE b."id" = bot_id AND b."publication"
      )
      AND (
        EXISTS (
          SELECT 1 FROM "bot_assignments" a
          WHERE a."botId" = bot_id AND a."userId" = app_user_id() AND a."accessLevel" = 'CHAT'
        )
        OR EXISTS (
          SELECT 1 FROM "bot_department_assignments" a
          JOIN "department_members" m ON m."departmentId" = a."departmentId"
          WHERE a."botId" = bot_id AND m."userId" = app_user_id() AND a."accessLevel" = 'CHAT'
        )
      )
  $$;

GRANT EXECUTE ON FUNCTION hive_may_chat(text) TO rakazo_app;

ALTER POLICY "threads_hive" ON "threads"
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND (
      NOT hive_org_enabled()
      OR (
        "userId" = app_user_id()
        AND ("botId" IS NULL OR "routineId" IS NOT NULL OR hive_may_chat("botId"))
      )
      OR (hive_admin_here() AND "routineId" IS NOT NULL)
    )
  );

ALTER POLICY "messages_hive" ON "messages"
  WITH CHECK (
    app_rls_version() >= 3
    AND EXISTS (
      SELECT 1 FROM "threads" t
      WHERE t."id" = "messages"."threadId"
        AND t."spaceId" = app_space_id()
        AND (
          NOT hive_org_enabled()
          OR (
            t."userId" = app_user_id()
            AND (t."botId" IS NULL OR t."routineId" IS NOT NULL OR hive_may_chat(t."botId"))
          )
        )
    )
  );

ALTER TABLE "bot_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bot_post_artifacts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bot_posts_system" ON "bot_posts"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "bot_post_artifacts_system" ON "bot_post_artifacts"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "bot_posts_read" ON "bot_posts" FOR SELECT
  USING (
    app_rls_version() >= 3
    AND (hive_bot_visible("botId") OR hive_admin_here())
  );

CREATE POLICY "bot_post_artifacts_read" ON "bot_post_artifacts" FOR SELECT
  USING (
    app_rls_version() >= 3
    AND EXISTS (
      SELECT 1 FROM "bot_posts" p
      WHERE p."id" = "bot_post_artifacts"."postId"
        AND (hive_bot_visible(p."botId") OR hive_admin_here())
    )
  );
