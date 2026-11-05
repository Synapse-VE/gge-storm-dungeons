import cron from 'node-cron';
import { env } from './env';
import { runStorm } from './storm';
import { runDungeons } from './dungeons';

const arguments_ = process.argv.slice(2);
const onceIndex = arguments_.indexOf('--once');
const onceJob = onceIndex >= 0 ? arguments_[onceIndex + 1] : '';

let stormRunning = false;
let dungeonsRunning = false;

async function storm(): Promise<void> {
  if (stormRunning) {
    console.log('Storm job already running, skipping');
    return;
  }
  stormRunning = true;
  try {
    await runStorm();
  } finally {
    stormRunning = false;
  }
}

async function dungeons(): Promise<void> {
  if (dungeonsRunning) {
    console.log('Dungeons job already running, skipping');
    return;
  }
  dungeonsRunning = true;
  try {
    await runDungeons();
  } finally {
    dungeonsRunning = false;
  }
}

async function main(): Promise<void> {
  if (onceJob === 'storm') {
    await storm();
    return;
  }
  if (onceJob === 'dungeons') {
    await dungeons();
    return;
  }

  console.log(`Scheduling storm: "${env.stormCron}"`);
  console.log(`Scheduling dungeons: "${env.dungeonsCron}"`);
  cron.schedule(env.stormCron, () => void storm());
  cron.schedule(env.dungeonsCron, () => void dungeons());

  if (process.env.COLLECTOR_RUN_ON_START !== '0') {
    await storm();
  }
  setInterval(() => undefined, 60_000);
}

void main().catch((error) => {
  console.error('Collector crashed:', error);
  process.exit(1);
});
