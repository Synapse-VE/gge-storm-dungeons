// Pure parser for the `gaa` dungeon rows, kept free of network/env imports.
export const DUNGEON_OBJECT_ID = 11;
export const PLAYER_COOLDOWN_SECONDS = 4 * 24 * 60 * 60;
export const MAP_SIZE = 1286;

export interface DungeonRow {
  kid: number;
  position_x: number;
  position_y: number;
  player_id: number | null;
  global_available_at: string;
  player_available_at: string;
  updated_at: string;
}

export function collectDungeons(
  kid: number,
  objects: any[],
  updates: Map<string, DungeonRow>,
  now = Date.now(),
): number {
  let added = 0;
  for (const row of objects) {
    if (!Array.isArray(row) || String(row[0]) !== String(DUNGEON_OBJECT_ID)) continue;
    const x = Number(row[1]);
    const y = Number(row[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x > MAP_SIZE || y > MAP_SIZE) continue;
    const remaining = Math.max(0, Number(row[5]) || 0);
    const attacker = Number(row[6]) || null;
    const key = `${kid}:${x}:${y}`;
    updates.set(key, {
      kid,
      position_x: x,
      position_y: y,
      player_id: attacker,
      global_available_at: new Date(now + remaining * 1000).toISOString(),
      player_available_at: new Date(now + (remaining + PLAYER_COOLDOWN_SECONDS) * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
    added++;
  }
  return added;
}
