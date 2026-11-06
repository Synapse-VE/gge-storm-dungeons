import path from 'node:path';
import dotenv from 'dotenv';

// The collector lives in apps/collector; the project .env is at the repo root.
dotenv.config({ path: path.resolve(__dirname, '../../..', '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  ggeApiUrl: required('GGE_API_URL').replace(/\/+$/, ''),
  ggeApiToken: process.env.GGE_API_TOKEN || process.env.API_KEY || '',
  ggeZone: process.env.GGE_ZONE || 'EmpireEx_25',
  ggeReadyUrl: process.env.GGE_READY_URL || '',
  stormCron: process.env.COLLECTOR_STORM_CRON || '*/10 * * * *',
  dungeonsCron: process.env.COLLECTOR_DUNGEONS_CRON || '*/15 * * * *',
  dungeonInitCron: process.env.COLLECTOR_DUNGEON_INIT_CRON || '5 3 * * 1',
  dungeonInitPauseMs: Number(process.env.DUNGEON_INIT_PAUSE_MS) || 30_000,
  httpTimeoutMs: Number(process.env.GGE_HTTP_TIMEOUT_MS) || 30_000,
};
