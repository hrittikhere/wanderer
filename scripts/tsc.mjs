// Runs the TypeScript 7 (native) CLI by explicit path. `node_modules/.bin/tsc`
// cannot be trusted in this monorepo: a transitive typescript@6 also ships a
// `tsc` bin and npm links whichever wins. Resolving `typescript/package.json`
// from this file finds the hoisted TypeScript 7 regardless of install layout.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const tsPackage = require.resolve('typescript/package.json');
const tsc = path.join(path.dirname(tsPackage), 'lib', 'tsc.js');
const major = Number(require('typescript/package.json').version.split('.')[0]);
if (major < 7) {
  console.error(`Expected TypeScript 7 or later for declaration emit, found ${require('typescript/package.json').version}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
