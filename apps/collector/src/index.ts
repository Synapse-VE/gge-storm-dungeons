import cron from 'node-cron';
import { env } from './env';
import { runStorm } from './storm';
import { runDungeons } from './dungeons';
import { isDungeonInitDue, runDungeonInit } from './dungeons-init';

const arguments_ = process.argv.slice(2);
const onceIndex = arguments_.indexOf('--once');
const onceJob = onceIndex >= 0 ? arguments_[onceIndex + 1] : '';

let stormRunning = false;
let dungeonRunning = false;

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
  if (dungeonRunning) {
    console.log('Dungeon job already running, skipping');
    return;
  }
  dungeonRunning = true;
  try {
    await runDungeons();
  } finally {
    dungeonRunning = false;
  }
}

async function dungeonInit(): Promise<void> {
  if (dungeonRunning) {
    console.log('Dungeon job already running, skipping init');
    return;
  }
  dungeonRunning = true;
  try {
    await runDungeonInit();
  } finally {
    dungeonRunning = false;
  }
}

async function dungeonInitIfDue(): Promise<void> {
  if (!(await isDungeonInitDue())) {
    console.log('Dungeon init is not due yet, skipping');
    return;
  }
  await dungeonInit();
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
  if (onceJob === 'init') {
    await dungeonInit();
    return;
  }

  console.log(`Scheduling storm: "${env.stormCron}"`);
  console.log(`Scheduling dungeons: "${env.dungeonsCron}"`);
  console.log(`Scheduling dungeon init: "${env.dungeonInitCron}" (UTC)`);
  cron.schedule(env.stormCron, () => void storm());
  cron.schedule(env.dungeonsCron, () => void dungeons());
  cron.schedule(env.dungeonInitCron, () => void dungeonInitIfDue(), { timezone: 'UTC' });

  if (process.env.COLLECTOR_RUN_ON_START !== '0') {
    await storm();
    void dungeonInitIfDue();
  }

  setInterval(() => undefined, 60_000);
}

void main().catch((error) => {
  console.error('Collector crashed:', error);
  process.exit(1);
});
