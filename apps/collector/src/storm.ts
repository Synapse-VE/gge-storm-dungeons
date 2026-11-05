import { gaa, isOk, sleep, waitForReady } from './game';
import { recordRun, supabase } from './db';

const STORM_KID = 4;
const STORM_CENTER_X = 644;
const STORM_CENTER_Y = 644;
const STORM_TILE_SPAN = 100;
const STORM_TILE_HALF_SPAN = 50;
const STORM_TILE_SPACING = 101;
const STORM_MAX_RINGS = 5;
const STORM_FORT_OBJECT_ID = 25;
const STORM_ISLE_OBJECT_ID = 24;
const STORM_BORDER_OBJECT_ID = 31;
const STORM_TILE_OBJECT_CEILING = 1000;
const STORM_MAX_FAILED_TILES = 10;
const MAP_SIZE = 1286;
const MAX_VICTORIES = 10;
const FREE_ISLE_STATE = 0;
const OCCUPIED_ISLE_STATE = 1;
const RESPAWNING_ISLE_STATE = 2;

interface StormTile {
  AX1: number;
  AY1: number;
  AX2: number;
  AY2: number;
}

interface StormFort {
  position_x: number;
  position_y: number;
  isle_id: number;
  victory_count: number;
  is_visible: boolean;
  available_at: string;
}

interface StormIsle {
  position_x: number;
  position_y: number;
  object_id: number;
  isle_id: number;
  occupier_id: number | null;
  state: number;
  available_at: string;
}

interface StormScan {
  forts: StormFort[];
  isles: StormIsle[];
  radius: number;
  borderReached: boolean;
  failedTiles: number;
  saturatedTiles: number;
  complete: boolean;
}

function ringTiles(ring: number): StormTile[] {
  const tiles: StormTile[] = [];
  for (let tileY = -ring; tileY <= ring; tileY++) {
    for (let tileX = -ring; tileX <= ring; tileX++) {
      if (ring > 0 && Math.abs(tileX) !== ring && Math.abs(tileY) !== ring) continue;
      const AX1 = STORM_CENTER_X - STORM_TILE_HALF_SPAN + tileX * STORM_TILE_SPACING;
      const AY1 = STORM_CENTER_Y - STORM_TILE_HALF_SPAN + tileY * STORM_TILE_SPACING;
      const AX2 = AX1 + STORM_TILE_SPAN;
      const AY2 = AY1 + STORM_TILE_SPAN;
      if (AX1 < 0 || AY1 < 0 || AX2 > MAP_SIZE || AY2 > MAP_SIZE) continue;
      tiles.push({ AX1, AY1, AX2, AY2 });
    }
  }
  return tiles;
}

function radiusToRings(radius: number): number {
  const rings = Math.ceil((radius - STORM_TILE_HALF_SPAN) / STORM_TILE_SPACING);
  return Math.min(Math.max(rings, 0), STORM_MAX_RINGS);
}

function ringsToRadius(rings: number): number {
  return STORM_TILE_HALF_SPAN + rings * STORM_TILE_SPACING;
}

function splitTile(tile: StormTile): StormTile[] {
  const midX = Math.floor((tile.AX1 + tile.AX2) / 2);
  const midY = Math.floor((tile.AY1 + tile.AY2) / 2);
  return [
    { AX1: tile.AX1, AY1: tile.AY1, AX2: midX, AY2: midY },
    { AX1: midX + 1, AY1: tile.AY1, AX2: tile.AX2, AY2: midY },
    { AX1: tile.AX1, AY1: midY + 1, AX2: midX, AY2: tile.AY2 },
    { AX1: midX + 1, AY1: midY + 1, AX2: tile.AX2, AY2: tile.AY2 },
  ];
}

async function requestArea(tile: StormTile): Promise<{ objects: any[]; failed: boolean }> {
  try {
    const response = await gaa(STORM_KID, tile.AX1, tile.AY1, tile.AX2, tile.AY2);
    if (isOk(response)) {
      const objects = Array.isArray(response.content?.AI) ? response.content.AI : [];
      return { objects, failed: false };
    }
    console.error('Storm tile returned an invalid code:', response?.return_code, tile);
  } catch (error) {
    console.error('Storm tile failed:', tile, error instanceof Error ? error.message : error);
  }
  return { objects: [], failed: true };
}

async function fetchArea(tile: StormTile): Promise<{ objects: any[]; failed: boolean }> {
  const whole = await requestArea(tile);
  if (!whole.failed) return whole;

  // A quarter frame survives the losses that time out a full far-away tile.
  const objects: any[] = [];
  let answered = false;
  for (const quarter of splitTile(tile)) {
    let area = await requestArea(quarter);
    if (area.failed && !answered) {
      console.error('Storm tile and its first quarter both failed, giving up the tile:', tile);
      return { objects, failed: true };
    }
    if (area.failed) {
      await sleep(1_000);
      area = await requestArea(quarter);
    }
    if (area.failed) {
      console.error('Storm quarter failed twice:', quarter);
      return { objects, failed: true };
    }
    answered = true;
    objects.push(...area.objects);
  }
  return { objects, failed: false };
}

function parseFort(row: any[], observedAt: Date): StormFort {
  const cooldownSeconds = Number(row[6]) || 0;
  return {
    position_x: Number(row[1]),
    position_y: Number(row[2]),
    isle_id: Number(row[5]),
    victory_count: Number(row[7]) || 0,
    is_visible: Number(row[8]) === 0,
    available_at: cooldownSeconds > 0 ? new Date(observedAt.getTime() + cooldownSeconds * 1000).toISOString() : observedAt.toISOString(),
  };
}

function parseIsle(row: any[], observedAt: Date): StormIsle {
  const occupierId = Number(row[4]);
  const remainingSeconds = Number(row[9]) || 0;
  const isOccupied = occupierId > 0;
  let state = FREE_ISLE_STATE;
  if (isOccupied) state = OCCUPIED_ISLE_STATE;
  else if (remainingSeconds > 0) state = RESPAWNING_ISLE_STATE;

  return {
    position_x: Number(row[1]),
    position_y: Number(row[2]),
    object_id: Number(row[3]),
    isle_id: Number(row[8]),
    occupier_id: isOccupied ? occupierId : null,
    state,
    available_at: remainingSeconds > 0 ? new Date(observedAt.getTime() + remainingSeconds * 1000).toISOString() : observedAt.toISOString(),
  };
}

async function scanRing(
  ring: number,
  forts: Map<string, StormFort>,
  isles: Map<string, StormIsle>,
  requestsSoFar: number,
): Promise<{ ringHasObjects: boolean; borderReached: boolean; requests: number; failedTiles: number; saturatedTiles: number }> {
  let ringHasObjects = false;
  let borderReached = false;
  let failedTiles = 0;
  let saturatedTiles = 0;
  let done = requestsSoFar;

  for (const tile of ringTiles(ring)) {
    const area = await fetchArea(tile);
    if (area.failed) failedTiles++;
    if (area.objects.length >= STORM_TILE_OBJECT_CEILING) saturatedTiles++;
    const observedAt = new Date();

    for (const object of area.objects) {
      const objectType = Number(object[0]);
      if (objectType === STORM_BORDER_OBJECT_ID) {
        borderReached = true;
        continue;
      }
      if (objectType === STORM_FORT_OBJECT_ID) {
        const fort = parseFort(object, observedAt);
        forts.set(`${fort.position_x}:${fort.position_y}`, fort);
        ringHasObjects = true;
      } else if (objectType === STORM_ISLE_OBJECT_ID) {
        const isle = parseIsle(object, observedAt);
        isles.set(`${isle.position_x}:${isle.position_y}`, isle);
        ringHasObjects = true;
      }
    }

    done++;
    await sleep(30);
    if (done % 5 === 0) await sleep(1_000);
  }

  return { ringHasObjects, borderReached, requests: done, failedTiles, saturatedTiles };
}

async function scanStormMap(knownRadius: number): Promise<StormScan> {
  const forts = new Map<string, StormFort>();
  const isles = new Map<string, StormIsle>();
  const knownRings = radiusToRings(knownRadius);
  let borderReached = false;
  let ring = 0;
  let reachedRings = knownRings;
  let done = 0;
  let failedTiles = 0;
  let saturatedTiles = 0;

  while (ring <= STORM_MAX_RINGS) {
    const scan = await scanRing(ring, forts, isles, done);
    done = scan.requests;
    failedTiles += scan.failedTiles;
    saturatedTiles += scan.saturatedTiles;
    borderReached = borderReached || scan.borderReached;

    if (scan.ringHasObjects && ring > reachedRings) reachedRings = ring;
    if (failedTiles >= STORM_MAX_FAILED_TILES) {
      throw new Error('Too many errors while scanning the storm map');
    }
    if (scan.failedTiles > 0 && !scan.ringHasObjects) {
      console.log('Storm ring answered nothing, stopping scan');
      break;
    }
    if (ring >= knownRings && (!scan.ringHasObjects || borderReached)) {
      console.log('Border reached for the current ring, stopping scan');
      break;
    }
    ring++;
  }

  return {
    forts: [...forts.values()],
    isles: [...isles.values()],
    radius: ringsToRadius(reachedRings),
    borderReached,
    failedTiles,
    saturatedTiles,
    complete: failedTiles === 0 && saturatedTiles === 0,
  };
}

export async function runStorm(): Promise<number> {
  const { value, error } = await recordRun('storm', async () => {
    if (!(await waitForReady())) throw new Error('empire-api is not ready');

    const { data: meta } = await supabase.from('storm_meta').select('scan_radius').maybeSingle();
    const knownRadius = Number(meta?.scan_radius) || 0;
    const scanStarted = new Date().toISOString();
    const scan = await scanStormMap(knownRadius);

    const { error: rpcError } = await supabase.rpc('upsert_storm_scan', {
      p_forts: scan.forts,
      p_isles: scan.isles,
      p_radius: scan.radius,
      p_complete: scan.complete,
      p_scan_started: scanStarted,
    });
    if (rpcError) throw new Error(rpcError.message);

    console.log(
      `Storm done: ${scan.forts.length} forts, ${scan.isles.length} isles, radius ${scan.radius}` +
        `${scan.borderReached ? ' (border reached)' : ''}${scan.complete ? '' : ' (partial)'}`,
    );
    return scan.forts.length + scan.isles.length;
  });

  if (error) console.error('Storm job failed:', error instanceof Error ? error.message : error);
  return typeof value === 'number' ? value : 0;
}
