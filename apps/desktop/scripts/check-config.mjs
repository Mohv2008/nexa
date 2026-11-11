import { readFile } from 'node:fs/promises';

for (const path of ['src-tauri/tauri.conf.json', 'src-tauri/capabilities/default.json']) {
  JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}
console.log('Tauri configuration is valid JSON.');
