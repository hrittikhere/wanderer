// The helpers the packed-consumer scripts share.
import { describe, test } from 'node:test';
import assert from './support/assert.js';
import path from 'node:path';
import { npmInvocation, skipInstallsAndBuilds } from '../scripts/consumer-utils.mjs';

describe('consumer script helpers', () => {
  test('npm runs through its own CLI under npm run, from PATH elsewhere, and through a quoting shell on Windows', () => {
    const cli = path.join('/opt', 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.deepEqual(npmInvocation(['pack'], { env: { npm_execpath: cli }, platform: 'win32', node: '/node' }), { command: '/node', args: [cli, 'pack'], shell: false });
    assert.deepEqual(npmInvocation(['pack'], { env: {}, platform: 'linux' }), { command: 'npm', args: ['pack'], shell: false });
    assert.deepEqual(npmInvocation(['pack'], { env: { npm_execpath: '/usr/lib/pnpm/bin/pnpm.cjs' }, platform: 'darwin' }), { command: 'npm', args: ['pack'], shell: false }, 'another package manager is not handed npm arguments');
    assert.deepEqual(
      npmInvocation(['pack', '--pack-destination', 'C:\\Users\\Ada Lovelace\\Temp'], { env: {}, platform: 'win32' }),
      { command: 'npm.cmd', args: ['pack', '--pack-destination', '"C:\\Users\\Ada Lovelace\\Temp"'], shell: true },
    );
  });

  test('the copy filter skips installs and builds inside the example only', () => {
    const from = path.join('/home', 'me', 'dist', 'wanderer', 'examples', 'vite');
    const keep = skipInstallsAndBuilds(from);
    assert.equal(keep(from), true, 'a checkout under a directory named dist is still copied');
    assert.equal(keep(path.join(from, 'src', 'main.tsx')), true);
    assert.equal(keep(path.join(from, 'node_modules')), false);
    assert.equal(keep(path.join(from, 'dist', 'index.html')), false);
    assert.equal(keep(path.join(from, 'src', 'distance.ts')), true, 'only whole segments match');
    assert.equal(skipInstallsAndBuilds(from, ['node_modules', '.next'])(path.join(from, 'dist')), true);
  });
});
