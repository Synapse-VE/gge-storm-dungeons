import { gaa, isOk, sleep, waitForReady } from './game';
import { recordRun, supabase } from './db';
import { env } from './env';

const MAP_SIZE = 1286;
const SCAN_SPAN = 100;
const SCAN_SPACING = 101;
const REALM_KIDS = [1, 2, 3];
const DUNGEON_OBJECT_ID = 11;
const PLAYER_COOLDOWN_SECONDS = 4 * 24 * 60 * 60;
const CHUNK_SIZE = 500;
const STATE_KEY = 'dungeons_init';
const MAX_FAILED_TILES = 20;

interface Tile {
  kid: number;
  AX1: number;
  AY1: number;
  AX2: number;
  AY2: number;
}

interface DungeonRow {
  kid: number;
  position_x: number;
  position_y: number;
  player_id: number | null;
  global_available_at: string;
  player_available_at: string;
  updated_at: string;
}

export interface DungeonInitResult {
  dungeons: number;
  tiles: number;
  failed: number;
  realms: number;
}

function mapTiles(kid: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < MAP_SIZE; y += SCAN_SPACING) {
    for (let x = 0; x < MAP_SIZE; x += SCAN_SPACING) {
      tiles.push({
        kid,
        AX1: x,
        AY1: y,
        AX2: Math.min(x + SCAN_SPAN, MAP_SIZE),
        AY2: Math.min(y + SCAN_SPAN, MAP_SIZE),
      });
    }
  }
  return tiles;
}

function collectDungeons(tile: Tile, objects: any[], updates: Map<string, DungeonRow>): number {
  const now = Date.now();
  let added = 0;
  for (const row of objects) {
    if (!Array.isArray(row) || String(row[0]) !== String(DUNGEON_OBJECT_ID)) continue;
    const x = Number(row[1]);
    const y = Number(row[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x > MAP_SIZE || y > MAP_SIZE) continue;
    const remaining = Math.max(0, Number(row[5]) || 0);
    const attacker = Number(row[6]) || null;
    const key = `${tile.kid}:${x}:${y}`;
    updates.set(key, {
      kid: tile.kid,
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

async function scanTile(tile: Tile): Promise<{ objects: any[]; failed: boolean }> {
  try {
    const response = await gaa(tile.kid, tile.AX1, tile.AY1, tile.AX2, tile.AY2);
    if (isOk(response)) {
      return { objects: Array.isArray(response.content?.AI) ? response.content.AI : [], failed: false };
    }
    console.error('Dungeon init tile returned an invalid code:', response?.return_code, tile);
  } catch (error) {
    console.error('Dungeon init tile failed:', tile, error instanceof Error ? error.message : error);
  }
  return { objects: [], failed: true };
}

async function flush(updates: Map<string, DungeonRow>): Promise<void> {
  const rows = [...updates.values()];
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase
      .from('dungeons')
      .upsert(chunk, { onConflict: 'kid,position_x,position_y' });
    if (error) throw new Error(error.message);
  }
}

async function getState(): Promise<{ completed_at?: string; dungeons?: number } | null> {
  const { data, error } = await supabase.from('scrape_state').select('value').eq('key', STATE_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as { completed_at?: string; dungeons?: number } | undefined) ?? null;
}

async function setState(result: DungeonInitResult): Promise<void> {
  const { error } = await supabase.from('scrape_state').upsert(
    {
      key: STATE_KEY,
      value: {
        completed_at: new Date().toISOString(),
        dungeons: result.dungeons,
        tiles: result.tiles,
        failed: result.failed,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) throw new Error(error.message);
}

export async function isDungeonInitDue(maxAgeDays = 7): Promise<boolean> {
  try {
    const state = await getState();
    const { count } = await supabase.from('dungeons').select('*', { count: 'exact', head: true });
    if (!count) return true;
    if (!state?.completed_at) return true;
    const ageMs = Date.now() - new Date(state.completed_at).getTime();
    return !Number.isFinite(ageMs) || ageMs >= maxAgeDays * 24 * 60 * 60 * 1000;
  } catch (error) {
    console.error('Could not read dungeon init state:', error instanceof Error ? error.message : error);
    return true;
  }
}

export async function runDungeonInit(): Promise<number> {
  const { value, error } = await recordRun('dungeons-init', async () => {
    if (!(await waitForReady())) throw new Error('empire-api is not ready');

    const updates = new Map<string, DungeonRow>();
    let tiles = 0;
    let failed = 0;
    let dungeons = 0;

    for (const [index, kid] of REALM_KIDS.entries()) {
      const kidTiles = mapTiles(kid);
      for (const [tileIndex, tile] of kidTiles.entries()) {
        const response = await scanTile(tile);
        tiles++;
        if (response.failed) {
          failed++;
          continue;
        }
        dungeons += collectDungeons(tile, response.objects, updates);
        if (tileIndex % 10 === 9) {
          await sleep(25);
          if (tileIndex % 20 === 19 && !(await waitForReady(15_000))) {
            throw new Error('empire-api lost readiness during dungeon init');
          }
        }
      }
      await flush(updates);
      console.log(`Dungeon init realm ${kid}: ${kidTiles.length} tiles, ${updates.size} unique dungeons so far`);
      if (index < REALM_KIDS.length - 1) await sleep(env.dungeonInitPauseMs);
    }

    const result: DungeonInitResult = { dungeons: updates.size, tiles, failed, realms: REALM_KIDS.length };
    if (failed > MAX_FAILED_TILES) {
      throw new Error(`${failed}/${tiles} dungeon init tiles failed`);
    }
    await setState(result);
    console.log(`Dungeon init done: ${result.dungeons} dungeons, ${tiles} tiles, ${failed} failed`);
    return result.dungeons;
  });

  if (error) console.error('Dungeon init job failed:', error instanceof Error ? error.message : error);
  return typeof value === 'number' ? value : 0;
}
