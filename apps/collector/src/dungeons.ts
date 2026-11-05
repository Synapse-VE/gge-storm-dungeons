import { gaa, isOk, sleep, waitForReady } from './game';
import { recordRun, supabase } from './db';

const MAP_SIZE = 1286;
const DUNGEON_OBJECT_ID = 11;
const PLAYER_COOLDOWN_SECONDS = 4 * 24 * 60 * 60;
const CHUNK_SIZE = 500;

interface DueDungeon {
  kid: number;
  position_x: number;
  position_y: number;
}

interface DungeonUpdate {
  kid: number;
  position_x: number;
  position_y: number;
  player_id: number | null;
  global_available_at: string;
  player_available_at: string;
  updated_at: string;
}

function correspondingSquare(x: number, y: number): { AX1: number; AY1: number; AX2: number; AY2: number } | null {
  const step = 12;
  const spacing = step + 1;
  const xIndex = Math.floor(x / spacing);
  const yIndex = Math.floor(y / spacing);
  const AX1 = xIndex * spacing;
  const AY1 = yIndex * spacing;
  const AX2 = AX1 + step;
  const AY2 = AY1 + step;
  if (AX1 >= 0 && AX2 <= MAP_SIZE && AY1 >= 0 && AY2 <= MAP_SIZE) return { AX1, AY1, AX2, AY2 };
  return null;
}

async function refreshSquare(dungeon: DueDungeon, updates: Map<string, DungeonUpdate>): Promise<void> {
  const square = correspondingSquare(dungeon.position_x, dungeon.position_y);
  if (!square) return;

  let response;
  try {
    response = await gaa(dungeon.kid, square.AX1, square.AY1, square.AX2, square.AY2);
  } catch (error) {
    console.error('Dungeon square failed:', square, error instanceof Error ? error.message : error);
    return;
  }
  if (!isOk(response)) {
    console.error('Dungeon square returned an invalid code:', response?.return_code, square);
    return;
  }

  const now = Date.now();
  const rows = Array.isArray(response.content?.AI) ? response.content.AI : [];
  for (const row of rows) {
    if (String(row[0]) !== String(DUNGEON_OBJECT_ID)) continue;
    const remaining = Number(row[5]) || 0;
    if (remaining <= 0) continue;
    const kid = dungeon.kid;
    const positionX = Number(row[1]);
    const positionY = Number(row[2]);
    const key = `${kid}:${positionX}:${positionY}`;
    updates.set(key, {
      kid,
      position_x: positionX,
      position_y: positionY,
      player_id: Number(row[6]) || null,
      global_available_at: new Date(now + remaining * 1000).toISOString(),
      player_available_at: new Date(now + (remaining + PLAYER_COOLDOWN_SECONDS) * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
  }
}

export async function runDungeons(): Promise<number> {
  const { value, error } = await recordRun('dungeons', async () => {
    if (!(await waitForReady())) throw new Error('empire-api is not ready');

    const due: DueDungeon[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: queryError } = await supabase
        .from('dungeons')
        .select('kid,position_x,position_y')
        .lte('global_available_at', new Date().toISOString())
        .order('kid')
        .order('position_x')
        .order('position_y')
        .range(from, from + 999);
      if (queryError) throw new Error(queryError.message);
      due.push(...((data ?? []) as DueDungeon[]));
      if (!data || data.length < 1000) break;
    }
    console.log(`Dungeons due: ${due.length}`);
    const updates = new Map<string, DungeonUpdate>();
    let done = 0;
    for (const dungeon of due) {
      await refreshSquare(dungeon, updates);
      done++;
      if (done % 20 === 0) await sleep(30);
    }

    const rows = [...updates.values()];
    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
      const chunk = rows.slice(index, index + CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('dungeons')
        .upsert(chunk, { onConflict: 'kid,position_x,position_y' });
      if (upsertError) throw new Error(upsertError.message);
    }

    console.log(`Dungeons refreshed: ${rows.length} cooldowns (${due.length} checked)`);
    return rows.length;
  });

  if (error) console.error('Dungeons job failed:', error instanceof Error ? error.message : error);
  return typeof value === 'number' ? value : 0;
}
