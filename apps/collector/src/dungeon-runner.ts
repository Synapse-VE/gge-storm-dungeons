import { REALM_KIDS, mapTiles, type Tile } from './dungeon-plan';
import { collectDungeons, type DungeonRow } from './dungeon-parse';

export interface ScanResult {
  objects: any[];
  failed: boolean;
}

export interface RunnerDeps {
  scan: (tile: Tile) => Promise<ScanResult>;
  flush: (rows: DungeonRow[]) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  pauseMs: number;
  onRealm?: (kid: number, tiles: number, unique: number) => void;
}

export interface RunnerResult {
  dungeons: number;
  tiles: number;
  failed: number;
  realms: number;
}

// Pure orchestration of the 3-realm full scan, injectable for tests.
export async function scanDungeonRealms(deps: RunnerDeps): Promise<RunnerResult> {
  const updates = new Map<string, DungeonRow>();
  let tiles = 0;
  let failed = 0;

  for (const [index, kid] of REALM_KIDS.entries()) {
    const kidTiles = mapTiles(kid);
    for (const [tileIndex, tile] of kidTiles.entries()) {
      const response = await deps.scan(tile);
      tiles++;
      if (response.failed) {
        failed++;
        continue;
      }
      collectDungeons(kid, response.objects, updates);
      if (tileIndex % 10 === 9) await deps.pause(25);
    }
    await deps.flush([...updates.values()]);
    deps.onRealm?.(kid, kidTiles.length, updates.size);
    if (index < REALM_KIDS.length - 1) await deps.pause(deps.pauseMs);
  }

  return { dungeons: updates.size, tiles, failed, realms: REALM_KIDS.length };
}
