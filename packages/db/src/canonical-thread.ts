/** The bot owner's conversation: the oldest thread that is not a routine. */
export const ownerThreadArgs = {
  where: { routineId: null },
  orderBy: { createdAt: "asc" as const },
  take: 1,
};

/**
 * The conversation a query asked for. A live query returns `threads` (at most
 * the owner's). A test double may still return the old single `thread`.
 */
export function ownerThread<T>(
  row: {
    threads?: readonly T[] | null;
    thread?: T | null;
  } | null,
): T | null {
  if (!row) return null;
  if (row.threads && row.threads.length > 0) return row.threads[0] ?? null;
  return row.thread ?? null;
}
