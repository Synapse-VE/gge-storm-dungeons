// Verifies the 3-realm orchestration: 507 scans, 3 flushes, failure accounting.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scanDungeonRealms } = require('../apps/collector/dist/dungeon-runner.js');

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

async function run(options = {}) {
  let calls = 0;
  const flushes = [];
  let pauses = 0;
  const result = await scanDungeonRealms({
    scan: async (tile) => {
      calls++;
      if (options.failTile && options.failTile(tile)) return { objects: [], failed: true };
      return {
        objects: [[11, tile.AX1 + 1, tile.AY1 + 1, 0, 0, 300, 123]],
        failed: false,
      };
    },
    flush: async (rows) => {
      flushes.push(rows.length);
    },
    pause: async () => {
      pauses++;
    },
    pauseMs: 10,
  });
  return { result, calls, flushes, pauses };
}

const first = await run();
if (first.calls !== 507) fail(`expected 507 scans, got ${first.calls}`);
if (first.result.tiles !== 507) fail(`expected 507 tiles, got ${first.result.tiles}`);
if (first.result.dungeons !== 507) fail(`expected 507 unique dungeons, got ${first.result.dungeons}`);
if (first.result.failed !== 0) fail(`expected 0 failures, got ${first.result.failed}`);
if (first.result.realms !== 3) fail(`expected 3 realms, got ${first.result.realms}`);
if (first.flushes.length !== 3) fail(`expected 3 flushes, got ${first.flushes.length}`);
if (first.flushes.join(',') !== '169,338,507') fail(`unexpected flush sizes ${first.flushes.join(',')}`);
if (first.pauses === 0) fail('expected throttling pauses');

const failed = await run({ failTile: (tile) => tile.kid === 1 && tile.AX1 === 0 && tile.AY1 === 0 });
if (failed.result.failed !== 1) fail(`expected 1 failed tile, got ${failed.result.failed}`);
if (failed.result.dungeons !== 506) fail(`expected 506 dungeons, got ${failed.result.dungeons}`);

console.log(`PASS: orchestration scanned ${first.calls} tiles, flushed 3 realms, accounted failures`);
