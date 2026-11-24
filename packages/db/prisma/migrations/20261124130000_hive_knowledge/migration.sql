-- Hive modification: knowledge collections, documents, and chunks.
-- Adding tables is safe for the previous release, which does not read them.
-- The Postgres image has to include pgvector. See docs/hive/INSTALL.md.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "hive_knowledge_collections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hive_knowledge_collections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hive_knowledge_collections_organizationId_idx" ON "hive_knowledge_collections"("organizationId");

CREATE TABLE "hive_collection_bots" (
    "collectionId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    CONSTRAINT "hive_collection_bots_pkey" PRIMARY KEY ("collectionId", "botId")
);
CREATE INDEX "hive_collection_bots_botId_idx" ON "hive_collection_bots"("botId");

CREATE TABLE "hive_knowledge_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "ocr" BOOLEAN NOT NULL DEFAULT false,
    "versionAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hive_knowledge_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hive_knowledge_documents_collectionId_idx" ON "hive_knowledge_documents"("collectionId");

CREATE TABLE "hive_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ordinal" INT NOT NULL,
    "section" TEXT NOT NULL DEFAULT '',
    "page" INT,
    "content" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "versionAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hive_knowledge_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hive_knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "hive_knowledge_documents"("id") ON DELETE CASCADE
);
CREATE INDEX "hive_knowledge_chunks_documentId_idx" ON "hive_knowledge_chunks"("documentId");
CREATE INDEX "hive_knowledge_chunks_embedding_idx" ON "hive_knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "hive_knowledge_acl" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkId" TEXT,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    CONSTRAINT "hive_knowledge_acl_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hive_knowledge_acl_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "hive_knowledge_documents"("id") ON DELETE CASCADE,
    CONSTRAINT "hive_knowledge_acl_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "hive_knowledge_chunks"("id") ON DELETE CASCADE
);
CREATE INDEX "hive_knowledge_acl_documentId_idx" ON "hive_knowledge_acl"("documentId");
CREATE INDEX "hive_knowledge_acl_chunkId_idx" ON "hive_knowledge_acl"("chunkId");

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "hive_knowledge_collections",
  "hive_collection_bots",
  "hive_knowledge_documents",
  "hive_knowledge_chunks",
  "hive_knowledge_acl"
TO rakazo_app;

-- The grant check runs as the migration owner so it can read memberships the caller cannot.
CREATE OR REPLACE FUNCTION hive_knowledge_subject_visible(chunk_id text, user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "hive_knowledge_acl" a
    WHERE a."chunkId" = chunk_id AND (
      (a.kind = 'person' AND a."subjectId" = user_id)
      OR (a.kind = 'department' AND EXISTS (
        SELECT 1 FROM "department_members" m
        WHERE m."departmentId" = a."subjectId" AND m."userId" = user_id
      ))
      OR (a.kind = 'organization' AND EXISTS (
        SELECT 1 FROM "hive_roles" r
        WHERE r."organizationId" = a."subjectId" AND r."userId" = user_id
      ))
    )
  );
$$;

CREATE OR REPLACE FUNCTION hive_knowledge_row_visible(chunk_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN current_setting('app.rls_bypass', true) = 'on' THEN true
    WHEN chunk_id IS NULL THEN false
    WHEN current_setting('app.knowledge_mode', true) = 'audience' THEN
      EXISTS (
        SELECT 1
        FROM unnest(string_to_array(COALESCE(current_setting('app.knowledge_audience', true), ''), ',')) AS recipient(id)
        WHERE recipient.id <> ''
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(string_to_array(COALESCE(current_setting('app.knowledge_audience', true), ''), ',')) AS recipient(id)
        WHERE recipient.id <> ''
          AND NOT hive_knowledge_subject_visible(chunk_id, recipient.id)
      )
    ELSE hive_knowledge_subject_visible(chunk_id, NULLIF(current_setting('app.user_id', true), ''))
  END;
$$;

GRANT EXECUTE ON FUNCTION hive_knowledge_subject_visible(text, text) TO rakazo_app;
GRANT EXECUTE ON FUNCTION hive_knowledge_row_visible(text) TO rakazo_app;

ALTER TABLE "hive_knowledge_collections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_collections" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hive_collection_bots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_collection_bots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_chunks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_acl" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hive_knowledge_acl" FORCE ROW LEVEL SECURITY;

CREATE POLICY "hive_knowledge_collections_system" ON "hive_knowledge_collections"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "hive_collection_bots_read" ON "hive_collection_bots"
  FOR SELECT USING (true);
CREATE POLICY "hive_collection_bots_write" ON "hive_collection_bots"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "hive_knowledge_documents_read" ON "hive_knowledge_documents"
  FOR SELECT USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM "hive_knowledge_chunks" c
      WHERE c."documentId" = "hive_knowledge_documents"."id"
        AND hive_knowledge_row_visible(c."id")
    )
  );
CREATE POLICY "hive_knowledge_documents_write" ON "hive_knowledge_documents"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "hive_knowledge_chunks_read" ON "hive_knowledge_chunks"
  FOR SELECT USING (hive_knowledge_row_visible("id"));
CREATE POLICY "hive_knowledge_chunks_write" ON "hive_knowledge_chunks"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "hive_knowledge_acl_read" ON "hive_knowledge_acl"
  FOR SELECT USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR ("chunkId" IS NOT NULL AND hive_knowledge_row_visible("chunkId"))
  );
CREATE POLICY "hive_knowledge_acl_write" ON "hive_knowledge_acl"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
