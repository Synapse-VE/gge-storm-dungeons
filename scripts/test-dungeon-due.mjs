// Verifies the 7-day checkpoint used by the automatic dungeon init.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isDungeonInitDueAt } = require('../apps/collector/dist/dungeon-state.js');

const now = Date.UTC(2026, 10, 6, 3, 5, 0);
const day = 24 * 60 * 60 * 1000;
const cases = [
  ['empty table is due', null, 0, true],
  ['missing checkpoint is due', null, 1692, true],
  ['invalid checkpoint is due', 'not-a-date', 1692, true],
  ['6 days old is not due', new Date(now - 6 * day).toISOString(), 1692, false],
  ['7 days old is due', new Date(now - 7 * day).toISOString(), 1692, true],
  ['8 days old is due', new Date(now - 8 * day).toISOString(), 1692, true],
];
let failed = 0;
for (const [name, completedAt, count, expected] of cases) {
  const actual = isDungeonInitDueAt(completedAt, count, now, 7);
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${actual}`);
  if (!ok) failed++;
}
if (failed > 0) process.exit(1);
console.log('PASS: dungeon init checkpoint math');
