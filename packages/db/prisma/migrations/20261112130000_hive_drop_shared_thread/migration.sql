-- Hive modification: a person has their own conversation with a bot.
-- Derived from Rakazo (Apache License 2.0).
--
-- Conversation rows are unique on (botId, userId). Routine rows share the
-- service account and stay unique on routineId, so the conversation unique is
-- partial. The one-thread-per-bot unique cannot stay beside either of those.

DROP INDEX IF EXISTS "threads_botId_key";
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_botId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "threads_bot_user_key" ON "threads"("botId", "userId")
  WHERE "botId" IS NOT NULL AND "routineId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "threads_routine_key" ON "threads"("routineId")
  WHERE "routineId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "threads_botId_idx" ON "threads"("botId");
