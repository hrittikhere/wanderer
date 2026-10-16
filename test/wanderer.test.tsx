import { afterEach, describe, test } from 'node:test';
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import assert from './support/assert.js';
import { Wanderer, type WandererProps } from '../src/globe.js';
import { Talks } from '../src/index.js';
import { installDom, click, setInputValue } from './support/dom.js';
import { hydrate, loadReactDomClient } from './support/react.js';
import { installFakeWebGl } from './support/webgl.js';
import { FIXTURE_TALKS } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();
const milestone = { id: 'first', title: 'First stage', coordinates: [38.72, -9.14] as const, description: 'An independent milestone.' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function mount(props: WandererProps = {}, denyWebGl = false) {
  const dom = installDom({ width: 1440, reducedMotion: true });
  const gl = installFakeWebGl(dom, denyWebGl ? { deny: () => true } : {});
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  cleanups.push(async () => { await act(async () => root.unmount()); gl.cleanup(); dom.cleanup(); });
  let current: WandererProps = { talks: FIXTURE_TALKS, milestones: [milestone], ...props };
  async function rerender(next: Partial<WandererProps> = {}) {
    current = { ...current, ...next };
    await act(async () => root.render(createElement(Wanderer, current)));
    for (let i = 0; i < 50 && container.querySelector('.wanderer-globe')?.getAttribute('data-wanderer-globe-status') === 'loading'; i += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  }
  await rerender();
  return { container, dom, gl, rerender };
}

describe('Wanderer core and independent additions', () => {
  test('defaults to just the globe and milestones on the server and client', async () => {
    const html = renderToString(createElement(Wanderer, { talks: FIXTURE_TALKS, milestones: [milestone] }));
    assert.ok(html.includes('wanderer-globe--core'));
    for (const selector of ['wanderer-toolbar', 'wanderer-globe__panel', 'wanderer-list', 'wanderer-globe__hint']) assert.equal(html.includes(selector), false, selector);
    const { container } = await mount();
    assert.equal(container.querySelector('.wanderer')?.getAttribute('data-wanderer-view'), 'globe');
    assert.ok(container.querySelector('canvas.wanderer-globe__canvas'));
    assert.ok(container.querySelector('.wanderer-globe__milestones select'));
    assert.equal(container.querySelector('.wanderer-toolbar'), null);
    assert.equal(container.querySelector('aside'), null);
  });

  test('milestones with coordinates work without a talks prop', async () => {
    const { container, dom } = await mount({ talks: undefined });
    assert.ok(container.querySelector('canvas.wanderer-globe__canvas'));
    const select = container.querySelector<HTMLSelectElement>('.wanderer-globe__milestones select')!;
    await act(async () => { select.value = 'first'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.equal(container.querySelector('.wanderer-milestone__title')?.textContent, 'First stage');
    assert.equal(container.querySelector('.wanderer-milestone__description')?.textContent, milestone.description);
  });

  for (const [prop, selector] of [
    ['enableSidebox', '.wanderer-globe__panel'],
    ['enableSearch', '.wanderer-search'],
    ['enableFilters', '.wanderer-filters'],
    ['enableResultCount', '.wanderer-toolbar__count'],
    ['enableList', '.wanderer-views'],
    ['enableHint', '.wanderer-globe__hint'],
  ] as const) {
    test(`${prop} enables only its own addition`, async () => {
      const { container } = await mount({ [prop]: true });
      assert.ok(container.querySelector(selector), selector);
      for (const [other, otherSelector] of [
        ['enableSidebox', '.wanderer-globe__panel'], ['enableSearch', '.wanderer-search'],
        ['enableFilters', '.wanderer-filters'], ['enableResultCount', '.wanderer-toolbar__count'],
        ['enableList', '.wanderer-views'], ['enableHint', '.wanderer-globe__hint'],
      ]) if (other !== prop) assert.equal(container.querySelector(otherSelector), null, other);
    });
  }

  test('enabling and disabling additions preserves the canvas and selected milestone', async () => {
    const { container, dom, gl, rerender } = await mount();
    const canvas = container.querySelector('canvas.wanderer-globe__canvas');
    const select = container.querySelector<HTMLSelectElement>('.wanderer-globe__milestones select')!;
    await act(async () => { select.value = 'first'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const programs = gl.programs;
    for (const enabled of [true, false, true, false]) {
      await rerender({ enableSidebox: enabled, enableList: enabled, enableSearch: enabled, enableFilters: enabled, enableResultCount: enabled });
      assert.equal(container.querySelector('canvas.wanderer-globe__canvas'), canvas);
      assert.equal(container.querySelector('.wanderer-milestone__title')?.textContent, 'First stage');
      assert.equal(gl.programs, programs, 'toggling additions must not recreate WebGL');
      assert.equal(container.querySelector('.wanderer-globe')?.classList.contains('wanderer-globe--core'), !enabled);
    }
  });

  test('the list is usable only after it is enabled, and disabling it returns to the globe', async () => {
    const { container, dom, rerender } = await mount({ enableList: true });
    const list = [...container.querySelectorAll('button')].find((button) => button.textContent === 'List')!;
    await act(async () => click(list, dom.window));
    assert.equal(container.querySelector('.wanderer')?.getAttribute('data-wanderer-view'), 'list');
    assert.ok(container.querySelector('.wanderer-talk'));
    await rerender({ enableList: false });
    assert.equal(container.querySelector('.wanderer')?.getAttribute('data-wanderer-view'), 'globe');
    assert.equal(container.querySelector('.wanderer-talk'), null);
  });

  test('optional search filters the globe without enabling the sidebox or list', async () => {
    const { container, dom } = await mount({ enableSearch: true, milestones: [] });
    await act(async () => setInputValue(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'no-such-location', dom.window));
    assert.equal(container.querySelector('.wanderer-empty__title')?.textContent, 'No talks on the map');
    assert.equal(container.querySelector('aside'), null);
    assert.equal(container.querySelector('.wanderer-views'), null);
  });

  test('a sidebox slot stays unmounted until the sidebox is enabled', async () => {
    let renders = 0;
    function Aside() { renders += 1; return createElement('p', { className: 'custom-aside' }, 'Extra'); }
    const { container, rerender } = await mount({ slots: { GlobeAside: Aside } });
    assert.equal(renders, 0);
    await rerender({ enableSidebox: true });
    assert.ok(container.querySelector('.custom-aside'));
    await rerender({ enableSidebox: false });
    assert.equal(container.querySelector('.custom-aside'), null);
  });

  test('WebGL fallback never promises a disabled list', async () => {
    const { container, rerender } = await mount({}, true);
    assert.ok(container.textContent?.includes('The globe could not be shown'));
    assert.equal(container.textContent?.includes('Everything is in the list'), false);
    assert.equal(container.textContent?.includes('Open the list'), false);
    await rerender({ enableList: true });
    assert.ok(container.textContent?.includes('Everything is in the list'));
    assert.ok([...container.querySelectorAll('button')].some((button) => button.textContent === 'Open the list'));
  });

  test('the default component hydrates its server markup without mismatches', async () => {
    const element = createElement(Wanderer, { talks: FIXTURE_TALKS, milestones: [milestone] });
    const html = renderToString(element);
    const dom = installDom({ width: 1440, reducedMotion: true });
    const gl = installFakeWebGl(dom);
    const container = dom.document.getElementById('root')!;
    container.innerHTML = html;
    const result = await hydrate(container, element);
    cleanups.push(async () => { await act(async () => result.root.unmount()); gl.cleanup(); dom.cleanup(); });
    assert.deepEqual(result.errors, []);
  });

  test('existing Talks defaults retain search, filters, counts and the list', () => {
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS }));
    for (const className of ['wanderer-search', 'wanderer-filters', 'wanderer-toolbar__count', 'wanderer-talk']) assert.ok(html.includes(className), className);
  });
});
