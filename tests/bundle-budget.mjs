import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'apps/web/.svelte-kit/output/client');
const manifest = JSON.parse(await readFile(resolve(output, '.vite/manifest.json'), 'utf8'));
const roots = Object.keys(manifest).filter(
  (key) =>
    key.endsWith('/nodes/0.js') ||
    key.endsWith('/nodes/2.js') ||
    key.endsWith('/nodes/3.js') ||
    key.endsWith('/app.js') ||
    key.endsWith('/client-entry.js') ||
    key.endsWith('/entry.js'),
);
const visited = new Set();

function visit(key) {
  if (!key || visited.has(key)) return;
  const entry = manifest[key];
  if (!entry) throw new Error(`Missing manifest entry: ${key}`);
  visited.add(key);
  for (const dependency of entry.imports ?? []) visit(dependency);
  // Dynamic imports (voice, native push, error pages) intentionally do not count toward first load.
}

for (const key of roots) visit(key);
let compressedBytes = 0;
let sourceBytes = 0;
for (const key of visited) {
  const entry = manifest[key];
  if (!entry.file.endsWith('.js')) continue;
  const source = await readFile(resolve(output, entry.file));
  sourceBytes += source.byteLength;
  compressedBytes += gzipSync(source).byteLength;
}
const limit = 150 * 1024;
console.log(
  `Initial JavaScript: ${(compressedBytes / 1024).toFixed(1)} KiB gzip (${(
    sourceBytes / 1024
  ).toFixed(1)} KiB raw, ${visited.size} chunks)`,
);
if (compressedBytes > limit) {
  throw new Error(
    `Initial JavaScript exceeds the 150 KiB gzip budget by ${compressedBytes - limit} bytes`,
  );
}

// Ensure the generated static site exists so a stale manifest cannot pass the budget check.
await stat(resolve(root, 'apps/web/build/index.html'));
