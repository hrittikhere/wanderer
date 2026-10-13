// Pass explicit filenames to Node instead of depending on shell or runner glob support.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await readdir(path.join(root, 'test'), { recursive: true }))
  .filter((file) => /\.test\.tsx?$/.test(file))
  .sort()
  .map((file) => path.join(root, 'test', file));
if (!files.length) throw new Error('No unit tests found.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files], {
  cwd: root, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
