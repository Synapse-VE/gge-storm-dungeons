// Verifies the automatic dungeon init covers the whole map without overlaps.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mapTiles } = require('../apps/collector/dist/dungeon-plan.js');

const MAP_SIZE = 1286;
let failed = 0;
const all = [];
for (const kid of [1, 2, 3]) {
  const tiles = mapTiles(kid);
  const keys = new Set(tiles.map((tile) => `${tile.AX1}:${tile.AY1}`));
  const okCount = tiles.length === 169;
  const okBounds = tiles.every(
    (tile) =>
      tile.kid === kid &&
      tile.AX1 >= 0 &&
      tile.AY1 >= 0 &&
      tile.AX2 <= MAP_SIZE &&
      tile.AY2 <= MAP_SIZE &&
      tile.AX2 > tile.AX1 &&
      tile.AY2 > tile.AY1,
  );
  const okUnique = keys.size === tiles.length;
  console.log(`${okCount && okBounds && okUnique ? 'PASS' : 'FAIL'} realm ${kid}: ${tiles.length} tiles, unique=${okUnique}, bounds=${okBounds}`);
  if (!okCount || !okBounds || !okUnique) failed++;
  all.push(...tiles);
}
const total = all.length;
console.log(`${total === 507 ? 'PASS' : 'FAIL'} total tiles: ${total}`);
if (total !== 507) failed++;
if (failed > 0) process.exit(1);
console.log('PASS: dungeon init plan covers 3 realms x 169 tiles');
