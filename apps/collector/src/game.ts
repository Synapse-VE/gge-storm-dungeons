import axios from 'axios';
import { env } from './env';

const BASE = env.ggeApiUrl;
const ZONE = env.ggeZone;
const ROOT = (() => {
  try {
    return new URL(BASE).origin;
  } catch {
    return BASE;
  }
})();

export interface GameResponse<T = any> {
  server: string;
  command: string;
  return_code: number | string;
  content: T;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForReady(timeoutMs = 180_000): Promise<boolean> {
  const url = env.ggeReadyUrl || `${ROOT}/ready`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await axios.get(url, { timeout: 8_000, validateStatus: () => true });
      if (response.status === 200) return true;
    } catch {
      // cold start / socket reconnecting
    }
    await sleep(3_000);
  }
  return false;
}

export async function command<T = any>(name: string, headers: string | null = null): Promise<GameResponse<T>> {
  const encoded = headers === null ? 'null' : encodeURIComponent(headers);
  const url = `${BASE}/${ZONE}/${name}/${encoded}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.get<GameResponse<T>>(url, { timeout: env.httpTimeoutMs });
      return response.data;
    } catch (error) {
      lastError = error;
      await sleep(2_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function isOk(response: GameResponse | null | undefined): boolean {
  if (!response) return false;
  return String(response.return_code) === '0';
}

export async function gaa(kid: number, ax1: number, ay1: number, ax2: number, ay2: number): Promise<GameResponse> {
  const headers = `"KID":${kid},"AX1":${ax1},"AY1":${ay1},"AX2":${ax2},"AY2":${ay2}`;
  return command('gaa', headers);
}

export { sleep, BASE, ZONE, ROOT };
