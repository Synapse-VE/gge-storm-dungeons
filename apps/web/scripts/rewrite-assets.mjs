// GitHub Pages project sites live under /<repo>/, while the app references
// assets with absolute /assets/... paths. Rewrite the built files once.
import fs from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] || 'dist/gge-tracker-frontend/browser';
const base = (process.argv[3] || '/').replace(/\/*$/, '/');
if (base === '/') {
  console.log('Base is /, nothing to rewrite');
  process.exit(0);
}

const extensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.txt']);
let changed = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!extensions.has(path.extname(entry.name))) continue;
    const original = fs.readFileSync(full, 'utf8');
    const next = original.replaceAll('/assets/', `${base}assets/`);
    if (next !== original) {
      fs.writeFileSync(full, next);
      changed++;
    }
  }
}

walk(dist);
console.log(`Rewrote /assets/ -> ${base}assets/ in ${changed} files`);
