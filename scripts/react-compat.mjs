// Packs the package and installs the tarball into isolated projects, one per
// React version, then runs an SSR + hydration + interaction check in each.
// Needs network access for `npm install`. Not part of `npm test` for that reason.
//
//   node scripts/react-compat.mjs            # React 18.3.1 and the installed 19.x
//   WANDERER_COMPAT_DIR=/some/dir node scripts/react-compat.mjs
//   WANDERER_REACT_VERSIONS=18.3.1,19.2.0 node scripts/react-compat.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const scratchDir = process.env.WANDERER_COMPAT_DIR ?? path.join(os.tmpdir(), 'wanderer-compat');
const installedReact = require('react/package.json').version;
const installedJsdom = require('jsdom/package.json').version;
const versions = (process.env.WANDERER_REACT_VERSIONS ?? `18.3.1,${installedReact}`).split(',').map((item) => item.trim()).filter(Boolean);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

mkdirSync(scratchDir, { recursive: true });
// Build explicitly and pack with --ignore-scripts: the prepack hook would run
// the same build, but its stdout would corrupt the --json output of npm pack.
const build = run(process.execPath, [path.join(packageRoot, 'scripts', 'build.mjs')], { cwd: packageRoot, stdio: ['ignore', 'inherit', 'inherit'] });
if (build.status !== 0) process.exit(build.status ?? 1);
const pack = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchDir], { cwd: packageRoot });
if (pack.status !== 0) {
  console.error(pack.stderr);
  process.exit(pack.status ?? 1);
}
const packed = JSON.parse(pack.stdout);
const tarball = path.join(scratchDir, packed[0].filename);
console.error(`packed ${packed[0].filename} (${packed[0].size} bytes, ${packed[0].entryCount} files)`);

const checkScript = String.raw`
import { JSDOM, VirtualConsole } from 'jsdom';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const summary = { react: null, singleReactCopy: null, esm: {}, cjs: {}, styles: null, widths: {}, consoleErrors: [], ok: true, failures: [] };
const fail = (message) => { summary.ok = false; summary.failures.push(message); };
const originalError = console.error;
console.error = (...args) => { summary.consoleErrors.push(args.map(String).join(' ')); };

const entries = ['@wanderer/talks', '@wanderer/talks/helpers', '@wanderer/talks/list', '@wanderer/talks/globe'];
const expected = {
  '@wanderer/talks': ['Talks', 'validateTalks', 'definePlugin', 'useTalks'],
  '@wanderer/talks/helpers': ['validateTalks', 'deriveGeography', 'groupTalks'],
  '@wanderer/talks/list': ['ListView', 'TalkCard', 'Toolbar'],
  '@wanderer/talks/globe': ['GlobeView', 'globeView', 'preloadGlobeView', 'GlobeRegionList'],
};
for (const entry of entries) {
  try {
    const mod = await import(entry);
    const missing = expected[entry].filter((name) => !(name in mod));
    summary.esm[entry] = missing.length ? 'missing: ' + missing.join(', ') : 'ok';
    if (missing.length) fail(entry + ' esm missing ' + missing.join(', '));
  } catch (error) { summary.esm[entry] = String(error); fail(entry + ' esm import failed: ' + error); }
  try {
    const mod = require(entry);
    const missing = expected[entry].filter((name) => !(name in mod));
    summary.cjs[entry] = missing.length ? 'missing: ' + missing.join(', ') : 'ok';
    if (missing.length) fail(entry + ' cjs missing ' + missing.join(', '));
  } catch (error) { summary.cjs[entry] = String(error); fail(entry + ' cjs require failed: ' + error); }
}
try {
  const styles = import.meta.resolve('@wanderer/talks/styles.css');
  const file = fileURLToPath(styles);
  summary.styles = existsSync(file) && file.endsWith(path.join('dist', 'styles.css')) ? 'ok' : 'unexpected: ' + file;
  if (summary.styles !== 'ok') fail('styles.css resolution');
} catch (error) { summary.styles = String(error); fail('styles.css resolve failed: ' + error); }

const React = await import('react');
summary.react = React.version;
const reactFromPackage = require.resolve('react', { paths: [path.dirname(require.resolve('@wanderer/talks/package.json'))] });
summary.singleReactCopy = reactFromPackage === require.resolve('react');
if (!summary.singleReactCopy) fail('the package resolves a different react copy');

const talks = [
  { id: 'north', title: 'Northern Lights Routing', event: 'Fjord Summit', date: '2030-02-01', description: 'A fictional talk.', format: 'in-person', location: 'Tromso, Norway', coordinates: [69.65, 18.96], recordingUrl: 'https://videos.example/north' },
  { id: 'south', title: 'Southern Cross Storage', event: 'Reef Conf', date: '2031-09-01', description: 'Another fictional talk.', format: 'hybrid', location: 'Cairns, Australia', coordinates: [-16.92, 145.77], eventUrl: 'https://reef.example' },
  { id: 'remote', title: 'Remote Pipelines', event: 'Online Meetup', date: '2031-07-07', description: 'Online only.', format: 'online' },
];

// The default breakpoint at both sides; a custom one, which adds an inline
// instance-scoped <style> that React 18 and 19 serialize differently; and a dark
// OS with a plugin renderer, so the color scheme and the card boundaries change
// right after hydration, which React 18 handles only for non-urgent updates.
for (const { width, breakpoint, dark } of [{ width: 390 }, { width: 1440 }, { width: 1000, breakpoint: 900 }, { width: 390, dark: true }]) {
  const label = String(width) + (breakpoint ? '@' + breakpoint : '') + (dark ? '-dark' : '');
  const result = { recoverableErrors: [], shellsBeforeHydration: 0, shellsAfterHydration: 0, viewAfterHydration: null, viewAfterClick: null, globeFallback: null, focusedHeading: null, viewChanges: [] };
  summary.widths[label] = result;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {});
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'https://example.test/', virtualConsole });
  const { window } = dom;
  window.matchMedia = (query) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : /prefers-color-scheme:\s*dark/.test(query) && Boolean(dark);
    return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLCanvasElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'IntersectionObserver']) {
    if (window[key] !== undefined) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { renderToString } = await import('react-dom/server');
  const { hydrateRoot } = await import('react-dom/client');
  const { Talks, definePlugin, useTalks } = await import('@wanderer/talks');
  const { globeView } = await import('@wanderer/talks/globe');
  const act = React.act ?? React.unstable_act;
  const Card = ({ talk }) => React.createElement('article', { className: 'compat-card', 'data-scheme': useTalks().colorScheme }, talk.title);
  const plugins = dark ? [definePlugin({ id: 'compat', renderers: [{ id: 'compat', Component: Card }] })] : undefined;
  const element = () => React.createElement(Talks, {
    talks, referenceDate: '2031-06-15', views: [globeView()], responsive: { small: 'list', large: 'globe', breakpoint }, plugins,
    onViewChange: (view, change) => result.viewChanges.push(view + ':' + change.reason),
  });
  const container = window.document.getElementById('root');
  container.innerHTML = renderToString(element());
  result.shellsBeforeHydration = container.querySelectorAll('.wanderer-shell').length;
  if (breakpoint) {
    const style = container.querySelector('style');
    const instance = container.querySelector('.wanderer').getAttribute('data-wanderer-instance');
    const selectors = style ? [...style.sheet.cssRules].map((rule) => rule.cssRules[0].selectorText) : [];
    result.inlineStyle = selectors;
    const expectedSelectors = ['small', 'large'].map((shell) => container.querySelector('[data-wanderer-instance="' + instance + '"] .wanderer-shell--' + shell));
    if (selectors.length !== 2 || selectors.some((selector, index) => container.querySelector(selector) !== expectedSelectors[index])) fail(label + ': the inline breakpoint rules do not match their shells');
  }
  let root;
  await act(async () => { root = hydrateRoot(container, element(), { onRecoverableError: (error) => result.recoverableErrors.push(String(error)) }); });
  const section = container.querySelector('.wanderer');
  result.shellsAfterHydration = container.querySelectorAll('.wanderer-shell').length;
  result.viewAfterHydration = section.getAttribute('data-wanderer-view');
  if (dark) {
    result.cardSchemes = [...section.querySelectorAll('.compat-card')].map((card) => card.getAttribute('data-scheme'));
    if (result.cardSchemes.length !== talks.length || result.cardSchemes.some((scheme) => scheme !== 'dark')) fail(label + ': plugin cards ' + JSON.stringify(result.cardSchemes));
  }
  const expectedView = width >= (breakpoint ?? 1024) ? 'globe' : 'list';
  if (result.viewAfterHydration !== expectedView) fail(label + ': expected ' + expectedView + ' after hydration, got ' + result.viewAfterHydration);
  if (result.recoverableErrors.length) fail(label + ': recoverable hydration errors');
  if (result.shellsBeforeHydration !== 2 || result.shellsAfterHydration !== 1) fail(label + ': shells ' + result.shellsBeforeHydration + ' -> ' + result.shellsAfterHydration);
  const other = [...section.querySelectorAll('.wanderer-views__button')].find((button) => button.getAttribute('aria-pressed') === 'false');
  await act(async () => { other.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  result.viewAfterClick = section.getAttribute('data-wanderer-view');
  result.focusedHeading = window.document.activeElement?.id ?? null;
  if (result.viewAfterClick === result.viewAfterHydration) fail(label + ': clicking the view switcher did not change the view');
  if (!result.focusedHeading || !result.focusedHeading.endsWith('-view-' + result.viewAfterClick + '-heading')) fail(label + ': focus did not move to the view heading');
  // Make sure the globe is active now, then assert the WebGL-less fallback.
  if (result.viewAfterClick !== 'globe') {
    const globeButton = [...section.querySelectorAll('.wanderer-views__button')].find((button) => button.textContent === 'Globe');
    await act(async () => { globeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  }
  const globe = section.querySelector('.wanderer-globe');
  result.globeFallback = globe ? { status: globe.getAttribute('data-wanderer-globe-status'), error: globe.getAttribute('data-wanderer-globe-error'), title: globe.querySelector('.wanderer-empty__title')?.textContent ?? null } : null;
  if (!globe || result.globeFallback.status !== 'error' || result.globeFallback.error !== 'webgl') fail(label + ': globe fallback not shown without WebGL');
  await act(async () => { root.unmount(); });
  window.close();
}
console.error = originalError;
if (summary.consoleErrors.length) fail('console.error was called during the checks');
process.stdout.write(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);
`;

const results = [];
for (const version of versions) {
  const projectDir = path.join(scratchDir, `react-${version}`);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, 'package.json'), `${JSON.stringify({
    name: `wanderer-compat-react-${version.replace(/[^\w.]/g, '-')}`,
    private: true,
    type: 'module',
    dependencies: {
      '@wanderer/talks': `file:${tarball}`,
      react: version,
      'react-dom': version,
      jsdom: installedJsdom,
    },
  }, null, 2)}\n`);
  writeFileSync(path.join(projectDir, 'check.mjs'), checkScript);
  console.error(`react ${version}: npm install in ${projectDir}`);
  const install = run('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: projectDir });
  if (install.status !== 0) {
    results.push({ version, ok: false, stage: 'install', stderr: install.stderr.slice(-2000) });
    console.log(JSON.stringify(results.at(-1)));
    continue;
  }
  const installedReactVersion = JSON.parse(readFileSync(path.join(projectDir, 'node_modules', 'react', 'package.json'), 'utf8')).version;
  const check = run(process.execPath, ['check.mjs'], { cwd: projectDir });
  let summary;
  try { summary = JSON.parse(check.stdout); } catch { summary = null; }
  const entry = { version: installedReactVersion, requested: version, ok: check.status === 0 && summary?.ok === true, stage: 'check', summary, stderr: check.status === 0 ? undefined : check.stderr.slice(-4000) };
  results.push(entry);
  console.log(JSON.stringify(entry));
}

const allOk = results.every((entry) => entry.ok);
console.error(allOk ? `react compat: ${results.map((entry) => entry.version).join(', ')} ok` : 'react compat: FAILED');
process.exit(allOk ? 0 : 1);
