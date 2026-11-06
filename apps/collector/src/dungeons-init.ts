import { gaa, isOk, sleep, waitForReady } from './game';
import { recordRun, supabase } from './db';
import { env } from './env';

import { MAP_SIZE, REALM_KIDS, mapTiles, type Tile } from './dungeon-plan';
import { collectDungeons, type DungeonRow } from './dungeon-parse';
import { isDungeonInitDueAt } from './dungeon-state';

const CHUNK_SIZE = 500;
const STATE_KEY = 'dungeons_init';
const MAX_FAILED_TILES = 20;

export interface DungeonInitResult {
  dungeons: number;
  tiles: number;
  failed: number;
  realms: number;
}

export async function scanTile(tile: Tile): Promise<{ objects: any[]; failed: boolean }> {
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
    return isDungeonInitDueAt(state?.completed_at, count, Date.now(), maxAgeDays);
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
        dungeons += collectDungeons(tile.kid, response.objects, updates);
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
