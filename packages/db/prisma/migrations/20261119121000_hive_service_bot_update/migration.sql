-- The worker runs as the service account and records the bot's last activity.
-- People still cannot change a bot they do not own.
CREATE POLICY "bots_hive_owner_update" ON "bots" FOR UPDATE
  USING (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND hive_org_enabled()
    AND "userId" = app_user_id()
    AND EXISTS (
      SELECT 1 FROM "user" u
      WHERE u."id" = "bots"."userId"
        AND u."hiveService" = true
        AND u."hiveArchivedAt" IS NULL
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND "spaceId" = app_space_id()
    AND hive_org_enabled()
    AND "userId" = app_user_id()
    AND EXISTS (
      SELECT 1 FROM "user" u
      WHERE u."id" = "bots"."userId"
        AND u."hiveService" = true
        AND u."hiveArchivedAt" IS NULL
    )
  );
