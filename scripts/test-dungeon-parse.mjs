// Verifies the pure gaa dungeon-row parser (cooldowns, player cooldown, filters).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { collectDungeons, PLAYER_COOLDOWN_SECONDS } = require('../apps/collector/dist/dungeon-parse.js');

const now = Date.UTC(2026, 10, 6, 0, 0, 0);
const updates = new Map();
const objects = [
  [11, 100, 200, 0, 0, 300, 123], // normal dungeon with cooldown
  [11, 300, 400, 0, 0, 0, 0], // available dungeon, no attacker
  [25, 500, 500, 0, 0, 100, 9], // fort, must be ignored
  [11, 2000, 10, 0, 0, 10, 1], // outside the map, ignored
  ['not-a-row'], // ignored
  [11, 100, 200, 0, 0, 0, 456], // duplicate position, last one wins
];
const added = collectDungeons(2, objects, updates, now);

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
if (added !== 3) fail(`expected 3 parsed rows, got ${added}`);
if (updates.size !== 2) fail(`expected 2 unique rows, got ${updates.size}`);
const first = updates.get('2:100:200');
if (!first) fail('missing 2:100:200');
if (first.player_id !== 456) fail(`duplicate should keep the last row, got ${first.player_id}`);
if (first.global_available_at !== new Date(now).toISOString()) fail('duplicate should reset the cooldown to now');
const second = updates.get('2:300:400');
if (!second) fail('missing 2:300:400');
if (second.player_id !== null) fail('missing attacker should be null');
if (new Date(second.global_available_at).getTime() !== now) fail('available dungeon should be available now');
if (new Date(second.player_available_at).getTime() !== now + PLAYER_COOLDOWN_SECONDS * 1000) {
  fail('player cooldown is not +4 days');
}
console.log(`PASS: parsed ${added} rows, ${updates.size} unique dungeons, cooldowns and filters OK`);
