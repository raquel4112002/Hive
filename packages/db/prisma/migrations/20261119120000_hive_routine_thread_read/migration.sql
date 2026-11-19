-- The service account owns the routine thread and has to read it to run.
-- A person still only sees their own conversation, where routineId is null.
ALTER POLICY "threads_hive" ON "threads"
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
      OR (
        "routineId" IS NOT NULL
        AND "userId" = app_user_id()
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
  );
