// Test the actual tarball in isolated consumer projects, without workspace
// symlinks masking missing exports, runtime dependencies or RSC directives.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = await mkdtemp(path.join(tmpdir(), 'wanderer-package-'));
function run(args, cwd = root, capture = false) {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed\n${result.stderr ?? ''}`);
  return result.stdout;
}
run(['run', 'build']);
const [{ filename }] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', destination], root, true));
const tarball = path.join(destination, filename);

for (const name of ['vite', 'next']) {
  const dir = path.join(destination, name);
  await cp(path.join(root, 'examples', name), dir, { recursive: true, filter: (source) => !/(?:^|[/\\])(?:node_modules|dist|\.next)(?:[/\\]|$)/.test(source) });
  const manifestPath = path.join(dir, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies['@wanderer/talks'] = `file:${tarball}`;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  run(['install', '--no-audit', '--no-fund'], dir);
  run(['run', 'build'], dir);
  console.log(`Packed ${name} integration passed.`);
}

const listDir = path.join(destination, 'list-only');
await cp(path.join(root, 'examples/vite'), listDir, { recursive: true, filter: (source) => !/(?:^|[/\\])(?:node_modules|dist)(?:[/\\]|$)/.test(source) });
await writeFile(path.join(listDir, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@wanderer/talks': `file:${tarball}`, react: '18.2.0', 'react-dom': '18.2.0' } }));
// The copied lock contains globe dependencies; install a genuinely fresh list consumer.
const { rm } = await import('node:fs/promises');
await rm(path.join(listDir, 'package-lock.json'), { force: true });
run(['install', '--omit=optional', '--no-audit', '--no-fund'], listDir);
const result = await build({ stdin: { contents: 'export { Talks } from "@wanderer/talks";', resolveDir: listDir }, bundle: true, format: 'esm', platform: 'browser', minify: true, write: false, metafile: true, external: ['react', 'react-dom', 'react/jsx-runtime'] });
assert.ok(!Object.keys(result.metafile.inputs).some((name) => /(?:cobe|globe\/renderer)/.test(name)), 'list consumer must not include WebGL');
const listBytes = gzipSync(result.outputFiles[0].contents).length;
assert.ok(listBytes < 18_000, `list gzip budget exceeded: ${listBytes} > 18000 bytes (React excluded)`);
const globe = await build({ stdin: { contents: 'export { globeView } from "@wanderer/talks/globe";', resolveDir: path.join(destination, 'vite') }, bundle: true, format: 'esm', platform: 'browser', minify: true, write: false, external: ['react', 'react-dom', 'react/jsx-runtime'] });
const globeBytes = gzipSync(globe.outputFiles[0].contents).length;
assert.ok(globeBytes < 30_000, `globe gzip budget exceeded: ${globeBytes} > 30000 bytes (cobe included, React excluded)`);
console.log(`Packed list without cobe passed. Gzip sizes: list ${listBytes} B, globe with cobe ${globeBytes} B. Fixtures: ${destination}`);
