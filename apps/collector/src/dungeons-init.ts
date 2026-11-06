import { gaa, isOk, sleep, waitForReady } from './game';
import { recordRun, supabase } from './db';
import { env } from './env';

import type { Tile } from './dungeon-plan';
import type { DungeonRow } from './dungeon-parse';
import { scanDungeonRealms } from './dungeon-runner';
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

async function flush(rows: DungeonRow[]): Promise<void> {
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

    let scanned = 0;
    const result = await scanDungeonRealms({
      scan: async (tile) => {
        const response = await scanTile(tile);
        scanned++;
        if (scanned % 20 === 0 && !(await waitForReady(15_000))) {
          throw new Error('empire-api lost readiness during dungeon init');
        }
        return response;
      },
      flush,
      pause: sleep,
      pauseMs: env.dungeonInitPauseMs,
      onRealm: (kid, tiles, unique) => {
        console.log(`Dungeon init realm ${kid}: ${tiles} tiles, ${unique} unique dungeons so far`);
      },
    });

    if (result.failed > MAX_FAILED_TILES) {
      throw new Error(`${result.failed}/${result.tiles} dungeon init tiles failed`);
    }
    await setState(result);
    console.log(`Dungeon init done: ${result.dungeons} dungeons, ${result.tiles} tiles, ${result.failed} failed`);
    return result.dungeons;
  });

  if (error) console.error('Dungeon init job failed:', error instanceof Error ? error.message : error);
  return typeof value === 'number' ? value : 0;
}
