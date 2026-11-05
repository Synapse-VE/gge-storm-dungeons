// Applies every SQL file in supabase/migrations through the Supabase
// Management API. Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in .env.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envFile = path.join(root, '.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"(.*)"$/, '$1')];
    }),
);

const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.SUPABASE_PROJECT_REF;
if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required');

const directory = path.join(root, 'supabase', 'migrations');
const files = fs.readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();
for (const file of files) {
  const query = fs.readFileSync(path.join(directory, file), 'utf8');
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`✘ ${file}: ${response.status} ${body}`);
    process.exit(1);
  }
  console.log(`✔ ${file}`);
}
await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "notify pgrst, 'reload schema';" }),
});
console.log('Schema cache reloaded');
