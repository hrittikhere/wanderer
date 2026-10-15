// Verifies the built package in dist/ against the public contract:
//   - every documented entry resolves through import() and require()
//   - declaration files exist for every entry, per condition (ESM and CommonJS)
//     and through typesVersions for node10 resolution
//   - "use client" directives are exactly where they belong
//   - the static import graph of the root, list, and helpers entries never
//     reaches dist/esm/globe/** or the bare specifier "cobe"
//   - only globe/renderer.js imports cobe
//   - package.json files/exports are consistent and sideEffects lists CSS only
//   - byte sizes (raw and gzip) per entry graph, printed as JSON on stdout
// Run after `node scripts/build.mjs`. Exits nonzero on any problem.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(packageRoot, 'dist');
const esmDir = path.join(distDir, 'esm');
const cjsDir = path.join(distDir, 'cjs');
const require = createRequire(import.meta.url);
const problems = [];
const problem = (message) => { problems.push(message); };

const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

// 1. Entries resolve in both module systems, and types exist.
const entries = {
  '.': ['Talks', 'listView', 'validateTalks', 'definePlugin', 'useTalks', 'DEFAULT_BREAKPOINT', 'TalkCard', 'resolveLinkPolicy', 'useMediaQuery'],
  './helpers': [
    'validateTalks', 'filterTalks', 'groupTalks', 'sortTalks', 'parseCalendarDate', 'formatCalendarDate', 'isUpcoming', 'classifyTalkDate',
    'talkYear', 'normalizeSearch', 'safeUrl', 'getTalkLinks', 'getPrimaryLink', 'DEFAULT_PRIMARY_LINK_PRECEDENCE', 'locationLabel', 'locationParts',
    'validCoordinates', 'resolveTalkCoordinates', 'geographicDistanceKm', 'deriveGeography', 'compareIds', 'registerPlugins', 'collectContributions',
  ],
  './list': ['ListView', 'listView', 'TalkCard', 'Toolbar', 'TalkGroupSection', 'EmptyState', 'TalkLinkAnchor', 'resolveLinkPolicy', 'Heading'],
  './globe': ['GlobeView', 'globeView', 'preloadGlobeView', 'GlobeRegionList'],
};
const resolvedEntries = {};
for (const [entry, expectedExports] of Object.entries(entries)) {
  const target = manifest.exports[entry];
  if (!target || typeof target !== 'object') { problem(`package.json exports is missing "${entry}"`); continue; }
  // Each condition carries its own declarations, listed first so TypeScript picks them.
  const conditions = [target.import, target.require];
  if (!conditions.every((condition) => condition && Object.keys(condition).join() === 'types,default')) {
    problem(`exports["${entry}"] must map import and require to { types, default }`);
    continue;
  }
  const esmPath = path.join(packageRoot, target.import.default);
  const cjsPath = path.join(packageRoot, target.require.default);
  const typesPath = path.join(packageRoot, target.import.types);
  const cjsTypesPath = path.join(packageRoot, target.require.types);
  resolvedEntries[entry] = { esmPath, cjsPath, typesPath, cjsTypesPath };
  for (const types of [target.import.types, target.require.types]) {
    if (!existsSync(path.join(packageRoot, types))) problem(`${entry}: types file ${types} is missing`);
  }
  // dist/cjs/package.json makes these CommonJS declarations; anywhere else they would read as ESM.
  if (path.dirname(cjsTypesPath) !== path.dirname(cjsPath)) problem(`${entry}: require types ${target.require.types} must sit next to ${target.require.default}`);
  try {
    const esm = await import(pathToFileURL(esmPath).href);
    for (const name of expectedExports) if (!(name in esm)) problem(`${entry} (esm) does not export ${name}`);
  } catch (error) {
    problem(`${entry} (esm) failed to import: ${error?.message ?? error}`);
  }
  try {
    const cjs = require(cjsPath);
    for (const name of expectedExports) if (!(name in cjs)) problem(`${entry} (cjs) does not export ${name}`);
  } catch (error) {
    problem(`${entry} (cjs) failed to require: ${error?.message ?? error}`);
  }
}
if (!existsSync(path.join(packageRoot, manifest.exports['./styles.css']))) problem('./styles.css target is missing');

// 2. Directive placement.
const withDirective = [
  'components/Talks.js', 'components/ListView.js', 'components/TalkCard.js', 'components/Toolbar.js', 'components/TalkLink.js',
  'components/ErrorBoundary.js', 'components/ViewShell.js', 'context.js', 'hooks.js', 'globe/GlobeView.js', 'globe/renderer.js',
];
const withoutDirective = ['index.js', 'helpers.js', 'list.js', 'globe.js', 'types.js', 'component-types.js', 'copy.js', 'plugins.js'];
const startsWithDirective = (file) => /^['"]use client['"]/.test(readFileSync(file, 'utf8').trimStart());
for (const format of [esmDir, cjsDir]) {
  const label = path.basename(format);
  for (const file of withDirective) {
    const full = path.join(format, file);
    if (!existsSync(full)) problem(`${label}/${file} is missing`);
    else if (!startsWithDirective(full)) problem(`${label}/${file} must start with "use client"`);
  }
  for (const file of withoutDirective) {
    const full = path.join(format, file);
    if (!existsSync(full)) problem(`${label}/${file} is missing`);
    else if (startsWithDirective(full)) problem(`${label}/${file} must not carry "use client"`);
  }
}

// 3. Static import graph walk (esm). Dynamic import() is deliberately excluded:
//    the globe entry reaches the renderer only through a lazy import.
const staticSpecifier = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
function staticImports(file) {
  const text = readFileSync(file, 'utf8');
  const specifiers = [];
  for (const match of text.matchAll(staticSpecifier)) specifiers.push(match[1] ?? match[2]);
  return specifiers;
}
function walkGraph(entryFile) {
  const visited = new Set();
  const bare = new Set();
  const queue = [entryFile];
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!existsSync(resolved)) problem(`${path.relative(distDir, file)} imports missing module ${specifier}`);
        else queue.push(resolved);
      } else {
        bare.add(specifier);
      }
    }
  }
  return { files: [...visited].sort(), bare: [...bare].sort() };
}
const graphs = {
  helpers: walkGraph(path.join(esmDir, 'helpers.js')),
  root: walkGraph(path.join(esmDir, 'index.js')),
  list: walkGraph(path.join(esmDir, 'list.js')),
  globe: walkGraph(path.join(esmDir, 'globe.js')),
};
for (const name of ['helpers', 'root', 'list']) {
  const graph = graphs[name];
  for (const file of graph.files) {
    if (path.relative(esmDir, file).startsWith('globe')) problem(`${name} graph reaches ${path.relative(distDir, file)}`);
  }
  if (graph.bare.includes('cobe')) problem(`${name} graph imports cobe`);
}
const helpersBare = graphs.helpers.bare.filter((name) => !name.startsWith('node:'));
if (helpersBare.length) problem(`helpers graph has runtime dependencies: ${helpersBare.join(', ')} (expected none)`);
if (!graphs.globe.files.some((file) => file.endsWith(path.join('globe', 'GlobeView.js')))) problem('globe graph does not include globe/GlobeView.js');
if (graphs.globe.files.some((file) => file.endsWith(path.join('globe', 'renderer.js')))) problem('globe graph statically imports the renderer (must be lazy)');

// 4. Only the renderer references cobe.
const cobeReference = /from\s+["']cobe["']|import\(\s*["']cobe["']\s*\)|require\(\s*["']cobe["']\s*\)/;
function listJs(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}
for (const dir of [esmDir, cjsDir]) {
  for (const file of listJs(dir)) {
    const relative = path.relative(dir, file).split(path.sep).join('/');
    const references = cobeReference.test(readFileSync(file, 'utf8'));
    if (references && relative !== 'globe/renderer.js') problem(`${path.basename(dir)}/${relative} references cobe`);
    if (!references && relative === 'globe/renderer.js') problem(`${path.basename(dir)}/globe/renderer.js does not import cobe`);
  }
}
if (!cobeReference.test(readFileSync(path.join(esmDir, 'globe', 'renderer.js'), 'utf8'))) problem('esm/globe/renderer.js must import cobe');

// 5. package.json consistency.
const exportTargets = (target) => (typeof target === 'string' ? [target] : Object.values(target).flatMap(exportTargets));
for (const [entry, target] of Object.entries(manifest.exports)) {
  for (const file of exportTargets(target)) {
    if (!existsSync(path.join(packageRoot, file))) problem(`exports["${entry}"] target ${file} does not exist`);
  }
}
// moduleResolution node10 ignores exports; typesVersions is how it finds subpath declarations.
for (const entry of Object.keys(entries).filter((name) => name !== '.')) {
  const mapped = manifest.typesVersions?.['*']?.[entry.slice(2)];
  if (!mapped?.length) problem(`typesVersions["*"] is missing "${entry.slice(2)}"`);
  for (const file of mapped ?? []) {
    if (!existsSync(path.join(packageRoot, file))) problem(`typesVersions["*"]["${entry.slice(2)}"] target ${file} does not exist`);
  }
}
for (const field of ['main', 'module', 'types']) {
  if (!existsSync(path.join(packageRoot, manifest[field]))) problem(`package.json ${field} target ${manifest[field]} does not exist`);
}
const sideEffects = Array.isArray(manifest.sideEffects) ? manifest.sideEffects : null;
if (!sideEffects || sideEffects.length === 0 || !sideEffects.every((pattern) => pattern.endsWith('.css'))) {
  problem(`sideEffects must list CSS patterns only, found ${JSON.stringify(manifest.sideEffects)}`);
}
if (!Array.isArray(manifest.files) || !manifest.files.includes('dist')) problem('package.json files must include dist');
for (const file of manifest.files ?? []) {
  if (!existsSync(path.join(packageRoot, file))) problem(`package.json files entry ${file} does not exist (npm would skip it silently)`);
}
if (!existsSync(path.join(cjsDir, 'package.json'))) problem('dist/cjs/package.json ({"type":"commonjs"}) is missing');
if (manifest.name.startsWith('@') && manifest.publishConfig?.access !== 'public') problem('scoped package needs publishConfig.access "public" (npm defaults scopes to restricted)');
// Source maps and relative Markdown links must resolve to files the tarball ships.
const shipped = (file) => (manifest.files ?? []).includes(path.relative(packageRoot, file).split(path.sep)[0]) && existsSync(file);
for (const file of readdirSync(distDir, { recursive: true })) {
  if (!file.endsWith('.map')) continue;
  const mapPath = path.join(distDir, file);
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  map.sources.forEach((source, index) => {
    if (typeof map.sourcesContent?.[index] === 'string') return;
    if (!shipped(path.resolve(path.dirname(mapPath), map.sourceRoot ?? '', source))) problem(`dist/${file} maps to ${source}, which the package does not ship`);
  });
}
const markdown = ['README.md', ...readdirSync(path.join(packageRoot, 'docs')).filter((name) => name.endsWith('.md')).map((name) => path.join('docs', name))];
for (const doc of markdown) {
  for (const [, href] of readFileSync(path.join(packageRoot, doc), 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:[a-z][\w+.-]*:|#)/i.test(href)) continue;
    if (!shipped(path.resolve(packageRoot, path.dirname(doc), href.split('#')[0]))) problem(`${doc} links to ${href}, which the package does not ship`);
  }
}

// 6. Sizes.
function sizeOf(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const buffer = readFileSync(file);
    raw += buffer.length;
    gzip += gzipSync(buffer, { level: 9 }).length;
  }
  return { raw, gzip, files: files.length };
}
const stylesPath = path.join(distDir, 'styles.css');
// The lazy chunk is everything the renderer pulls in that the eager globe graph does not already contain.
const rendererGraph = walkGraph(path.join(esmDir, 'globe', 'renderer.js'));
const lazyFiles = rendererGraph.files.filter((file) => !graphs.globe.files.includes(file));
graphs.globeRendererLazy = { files: lazyFiles, bare: rendererGraph.bare };
const sizes = {
  helpers: sizeOf(graphs.helpers.files),
  root: sizeOf(graphs.root.files),
  list: sizeOf(graphs.list.files),
  globe: sizeOf(graphs.globe.files),
  globeRendererLazy: sizeOf(lazyFiles),
  stylesCss: sizeOf([stylesPath]),
};
const output = {
  ok: problems.length === 0,
  problems,
  sizes,
  graphs: Object.fromEntries(Object.entries(graphs).map(([name, graph]) => [name, {
    files: graph.files.map((file) => path.relative(esmDir, file).split(path.sep).join('/')),
    bare: graph.bare,
  }])),
  note: 'Sizes are per-module sums of the static esm import graph (raw and gzip -9 bytes); external packages such as react are not included.',
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (problems.length) {
  console.error(problems.map((item) => ` - ${item}`).join('\n'));
  process.exit(1);
}

