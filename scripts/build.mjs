// Build pipeline:
//   1. esbuild transpiles every source file one-to-one (no bundling) into
//      dist/esm and dist/cjs. Keeping the module graph intact preserves the
//      per-file "use client" directives, lets bundlers code-split the lazily
//      imported globe renderer, and keeps tree shaking at module granularity.
//   2. TypeScript 7 (native) emits declarations only. tsup/tsdown/rollup-plugin-dts
//      need the JavaScript compiler API, which TypeScript 7.0 does not ship.
//   3. styles.css is copied verbatim; it is plain CSS with no preprocessor.
//   4. The output is checked: directives preserved, entries present, no
//      `cobe` reference outside the globe renderer module.
import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(packageRoot, 'src');
const distDir = path.join(packageRoot, 'dist');
const require = createRequire(import.meta.url);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  }));
  return files.flat();
}

const sources = await walk(srcDir);
await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const shared = {
  entryPoints: sources,
  outbase: srcDir,
  target: ['es2020'],
  jsx: 'automatic',
  sourcemap: true,
  sourcesContent: false,
  logLevel: 'warning',
  // Declarations are emitted by tsc; esbuild only strips types.
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', verbatimModuleSyntax: true } },
};

await build({ ...shared, outdir: path.join(distDir, 'esm'), format: 'esm' });
await build({ ...shared, outdir: path.join(distDir, 'cjs'), format: 'cjs' });
// The package is "type": "module"; this nested manifest makes dist/cjs/*.js CommonJS.
await writeFile(path.join(distDir, 'cjs', 'package.json'), '{\n  "type": "commonjs"\n}\n');

const tsPackage = require.resolve('typescript/package.json');
const tsc = path.join(path.dirname(tsPackage), 'lib', 'tsc.js');
const tscResult = spawnSync(process.execPath, [tsc, '-p', path.join(packageRoot, 'tsconfig.json')], {
  stdio: 'inherit',
  cwd: packageRoot,
});
if (tscResult.status !== 0) {
  console.error('Declaration emit failed.');
  process.exit(tscResult.status ?? 1);
}

// dist/types sits under the package's "type": "module", so TypeScript reads those
// declarations as ESM. The `require` condition points at a copy inside dist/cjs,
// whose package.json makes them CommonJS declarations (module node16 consumers).
for (const file of await readdir(path.join(distDir, 'types'), { recursive: true })) {
  if (/\.d\.ts(?:\.map)?$/.test(file)) await cp(path.join(distDir, 'types', file), path.join(distDir, 'cjs', file));
}

await cp(path.join(srcDir, 'styles.css'), path.join(distDir, 'styles.css'));

// Post-build checks. Directive preservation is the one that silently breaks
// Next.js consumers, so it fails the build rather than warning.
const problems = [];
for (const source of sources) {
  const text = await readFile(source, 'utf8');
  const relative = path.relative(srcDir, source).replace(/\.tsx?$/, '.js');
  const hasDirective = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*))*['"]use client['"]/.test(text);
  for (const format of ['esm', 'cjs']) {
    const output = await readFile(path.join(distDir, format, relative), 'utf8');
    const outputHasDirective = /^['"]use client['"]/.test(output.trimStart());
    if (hasDirective !== outputHasDirective) {
      problems.push(`${format}/${relative}: "use client" directive ${hasDirective ? 'lost' : 'unexpectedly added'}`);
    }
  }
}

for (const file of await readdir(path.join(distDir, 'esm'), { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  const text = await readFile(path.join(distDir, 'esm', file), 'utf8');
  const referencesCobe = /from\s+["']cobe["']|import\(\s*["']cobe["']\s*\)|require\(\s*["']cobe["']\s*\)/.test(text);
  const allowed = file.replace(/\\/g, '/') === 'globe/renderer.js';
  if (referencesCobe && !allowed) problems.push(`esm/${file} references cobe; only globe/renderer.js may.`);
}

for (const entry of ['index', 'helpers', 'list', 'globe']) {
  for (const target of [`esm/${entry}.js`, `cjs/${entry}.js`, `types/${entry}.d.ts`, `cjs/${entry}.d.ts`]) {
    await readFile(path.join(distDir, target)).catch(() => problems.push(`missing build output: dist/${target}`));
  }
}

if (problems.length) {
  console.error(problems.map((problem) => ` - ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`Built ${sources.length} modules to dist/ (esm, cjs, types) and copied styles.css.`);
