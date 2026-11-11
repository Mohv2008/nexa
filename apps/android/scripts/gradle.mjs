import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const task = process.argv[2];
if (!['assembleDebug', 'assembleRelease'].includes(task))
  throw new Error('Unsupported Gradle task');
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../android');
const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(executable, [task, '--no-daemon'], {
  cwd,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
