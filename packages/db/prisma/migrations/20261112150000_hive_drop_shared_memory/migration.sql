-- deferred
-- Hive modification: drop the shared bot-memory unique after the previous release is gone.
-- Derived from Rakazo (Apache License 2.0).
DROP INDEX IF EXISTS "memory_documents_spaceId_scope_botId_path_key";
ALTER TABLE "memory_documents" DROP CONSTRAINT IF EXISTS "memory_documents_spaceId_scope_botId_path_key";
