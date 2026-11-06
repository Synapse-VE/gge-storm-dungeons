// Regression test for the Supabase permission hardening (migration 0003).
// Fails if anon can read base tables or write through the public views.
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"(.*)"$/, '$1')];
    }),
);
const url = env.SUPABASE_URL;
const key = env.SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const checks = [
  ['view v_storm_forts select', 'GET', '/rest/v1/v_storm_forts?select=*&limit=1', null, (status) => status === 200],
  ['view v_storm_isles select', 'GET', '/rest/v1/v_storm_isles?select=*&limit=1', null, (status) => status === 200],
  ['view v_storm_meta select', 'GET', '/rest/v1/v_storm_meta?select=*&limit=1', null, (status) => status === 200],
  ['view v_dungeons select', 'GET', '/rest/v1/v_dungeons?select=*&limit=1', null, (status) => status === 200],
  ['view v_dungeons_meta select', 'GET', '/rest/v1/v_dungeons_meta?select=*&limit=1', null, (status) => status === 200],
  ['view v_dungeons_history select', 'GET', '/rest/v1/v_dungeons_history?select=*&limit=1', null, (status) => status === 200],
  ['view v_players select', 'GET', '/rest/v1/v_players?select=*&limit=1', null, (status) => status === 200],
  ['base table select blocked', 'GET', '/rest/v1/players?select=id&limit=1', null, (status) => status === 401 || status === 403],
  ['scrape_state select blocked', 'GET', '/rest/v1/scrape_state?select=key&limit=1', null, (status) => status === 401 || status === 403],
  ['view update blocked', 'PATCH', '/rest/v1/v_storm_forts?position_x=eq.597&position_y=eq.667', { victory_count: 1 }, (status) => status === 401 || status === 403],
  ['view insert blocked', 'POST', '/rest/v1/v_dungeons_history', { kid: 1, position_x: 1, position_y: 1, attacked_at: new Date().toISOString() }, (status) => status === 401 || status === 403],
  ['rpc blocked', 'POST', '/rest/v1/rpc/upsert_storm_scan', {}, (status) => status >= 400],
];

let failed = 0;
for (const [name, method, endpoint, body, predicate] of checks) {
  const response = await fetch(`${url}${endpoint}`, {
    method,
    headers: { ...headers, Prefer: 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ok = predicate(response.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${response.status}`);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`${failed} permission check(s) failed`);
  process.exit(1);
}
console.log('PASS: anon reads views only; base tables and writes are blocked');
