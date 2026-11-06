// Pure dungeon scan planning, kept free of env/network imports so it can be
// tested in CI without Supabase or game credentials.
export const MAP_SIZE = 1286;
export const SCAN_SPAN = 100;
export const SCAN_SPACING = 101;
export const REALM_KIDS = [1, 2, 3];

export interface Tile {
  kid: number;
  AX1: number;
  AY1: number;
  AX2: number;
  AY2: number;
}

export function mapTiles(kid: number): Tile[] {
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
