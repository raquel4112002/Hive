-- A memory revision follows its document. The owner is the person or the
-- service account on that document. Another person in the same space cannot
-- read or write it. Version 3 turned the old space-wide policy off.

CREATE POLICY "memory_revisions_hive" ON "memory_revisions"
  USING (
    app_rls_version() >= 3
    AND EXISTS (
      SELECT 1 FROM "memory_documents" d
      WHERE d."id" = "memory_revisions"."documentId"
        AND d."spaceId" = app_space_id()
        AND (
          NOT hive_org_enabled()
          OR (
            d."userId" = app_user_id()
            AND NOT EXISTS (
              SELECT 1 FROM "user" u
              WHERE u."id" = d."userId" AND u."hiveArchivedAt" IS NOT NULL
            )
          )
        )
    )
  )
  WITH CHECK (
    app_rls_version() >= 3
    AND EXISTS (
      SELECT 1 FROM "memory_documents" d
      WHERE d."id" = "memory_revisions"."documentId"
        AND d."spaceId" = app_space_id()
        AND (NOT hive_org_enabled() OR d."userId" = app_user_id())
    )
  );
