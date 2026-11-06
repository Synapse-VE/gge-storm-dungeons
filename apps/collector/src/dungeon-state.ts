// Pure checkpoint math for the automatic dungeon init, testable without env.
const DAY_MS = 24 * 60 * 60 * 1000;

export function isDungeonInitDueAt(
  completedAt: string | null | undefined,
  dungeonCount: number | null | undefined,
  now = Date.now(),
  maxAgeDays = 7,
): boolean {
  if (!dungeonCount || dungeonCount <= 0) return true;
  if (!completedAt) return true;
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(completed)) return true;
  return now - completed >= maxAgeDays * DAY_MS;
}
