import fs from 'node:fs';
import path from 'node:path';
import { supabase } from './db';

const CHUNK_SIZE = 500;

function readJson<T>(name: string): T[] {
  const file = path.resolve(__dirname, '../../../supabase/seed', name);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T[];
}

async function seedAlliances(): Promise<void> {
  const rows = readJson<Record<string, unknown>>('alliances.json');
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from('alliances').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`alliances: ${error.message}`);
  }
  console.log(`Alliances seeded: ${rows.length}`);
}

async function seedPlayers(): Promise<void> {
  const rows = readJson<Record<string, unknown>>('players.json').map((player) => ({
    ...player,
    current_fame: player.current_fame === null ? null : String(player.current_fame),
    highest_fame: player.highest_fame === null ? null : String(player.highest_fame),
  }));
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from('players').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`players: ${error.message}`);
  }
  console.log(`Players seeded: ${rows.length}`);
}

async function seedDungeons(): Promise<void> {
  const rows = readJson<Record<string, unknown>>('dungeons.json');
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from('dungeons').upsert(chunk, { onConflict: 'kid,position_x,position_y' });
    if (error) throw new Error(`dungeons: ${error.message}`);
  }
  console.log(`Dungeons seeded: ${rows.length}`);
}

async function seedDungeonsHistory(): Promise<void> {
  const { count } = await supabase.from('dungeons_history').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) {
    console.log(`Dungeons history already has ${count} rows, skipping`);
    return;
  }
  const rows = readJson<Record<string, unknown>>('dungeons_history.json');
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from('dungeons_history').insert(chunk);
    if (error) throw new Error(`dungeons_history: ${error.message}`);
  }
  console.log(`Dungeons history seeded: ${rows.length}`);
}

async function main(): Promise<void> {
  await seedAlliances();
  await seedPlayers();
  await seedDungeons();
  await seedDungeonsHistory();
}

void main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
