// Regression test: the standalone shell must not show the generic error toast.
// Requires the web app running (default http://127.0.0.1:4300/storm-tracker).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.env.SMOKE_URL || 'http://127.0.0.1:4300/storm-tracker';
const chrome = process.env.CHROME_BIN || 'google-chrome';
const port = Number(process.env.SMOKE_DEBUG_PORT || 9333);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gge-smoke-'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-extensions',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let socket;
try {
  let targets = null;
  for (let attempt = 0; attempt < 50 && !targets; attempt++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      await wait(200);
    }
  }
  if (!targets) throw new Error('Chrome DevTools endpoint did not start');
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No page target');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  const navigation = await send('Page.navigate', { url });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);

  let text = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(500);
    const result = await send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    });
    text = result.result?.value || '';
    if (text.includes('Último escaneo') && text.includes('Nivel')) break;
  }

  // The toast lives 5 seconds; wait for its window to pass before failing.
  await wait(5500);
  const finalResult = await send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText : ""',
    returnByValue: true,
  });
  text = finalResult.result?.value || '';

  if (!text.includes('Último escaneo') || !text.includes('Nivel')) {
    const debug = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ href: location.href, title: document.title, text: document.body ? document.body.innerText.slice(0, 300) : "" })',
      returnByValue: true,
    });
    throw new Error(`The storm page did not render: ${debug.result?.value}`);
  }
  if (text.includes('Se ha producido un error')) {
    throw new Error('Regression: the generic error toast is visible');
  }
  console.log('PASS: storm page rendered without the error toast');
} finally {
  try {
    socket?.close();
  } catch {}
  browser.kill('SIGKILL');
  fs.rmSync(profile, { recursive: true, force: true });
}
