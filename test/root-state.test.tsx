// The public root and list exports and hooks used directly, plus root-state
// behavior: server-side containment, inline literals, copy merging and the
// plugin entry contract.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement, useState } from 'react';
import { renderToString } from 'react-dom/server';
import {
  DEFAULT_BREAKPOINT, EmptyState, ErrorBoundary, Heading, ListView, TalkCard, TalkGroupSection, Talks, Toolbar,
  createDefaultCopy, definePlugin, listView, mergeCopy, registerPlugins, useControllable, useIsClient, useMediaQuery,
  type TalkRendererProps, type TalkViewProps, type TalksContext, type TalksPlugin,
} from '../src/index.js';
import * as listEntry from '../src/list.js';
import * as helpersEntry from '../src/helpers.js';
import { click, installDom, setInputValue } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function mountElement(element: ReturnType<typeof createElement>) {
  const dom = installDom({ width: 1440 });
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
  await act(async () => { root.render(element); });
  return { dom, container, root };
}

/** Captures the instance context through a view so pieces can be rendered on their own. */
function captureContext(): Promise<TalksContext> {
  let captured: TalksContext | undefined;
  const Capture = ({ context }: TalkViewProps) => { captured = context; return null; };
  renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [{ id: 'capture', label: 'Capture', Component: Capture }], defaultView: 'capture' }));
  return Promise.resolve(captured!);
}

describe('server rendering contains failing plugin code', () => {
  test('a renderer or view that throws on the server falls back to client rendering instead of failing the page', () => {
    const Fragile = ({ talk: item }: TalkRendererProps) => {
      if (item.id === 'aurora-2030') throw new Error('reads window during render');
      return createElement('p', { className: 'fragile' }, item.title);
    };
    const plugin = definePlugin({ id: 'fragile', renderers: [{ id: 'fragile', Component: Fragile }] });
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, plugins: [plugin] }));
    assert.equal([...html.matchAll(/class="fragile"/g)].length, FIXTURE_TALKS.length - 1, 'every other card is server-rendered');
    assert.ok(html.includes('<!--$!-->'), 'the failing card is marked for client rendering');

    const Broken = () => { throw new Error('server only'); };
    const viewHtml = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, views: [{ id: 'broken', label: 'Broken', Component: Broken }], defaultView: 'broken' }));
    assert.ok(viewHtml.includes('wanderer-toolbar'), 'the toolbar and heading still render');
    assert.ok(viewHtml.includes('<!--$!-->'));
  });
});

describe('inline literals', () => {
  test('an inline plugins array or copy literal with the same items does not recompute the results', async () => {
    let predicateCalls = 0;
    const plugin: TalksPlugin = { id: 'counting', filters: [{ id: 'counting', label: 'Counting', predicate: () => { predicateCalls += 1; return true; } }] };
    let rerender!: () => void;
    function Parent() {
      const [tick, setTick] = useState(0);
      rerender = () => setTick((value) => value + 1);
      return createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, plugins: [plugin], copy: { noTalks: `Nothing ${tick % 1}` }, defaultFilters: ['counting'] });
    }
    await mountElement(createElement(Parent));
    const afterMount = predicateCalls;
    assert.ok(afterMount > 0);
    for (let index = 0; index < 3; index += 1) await act(async () => { rerender(); });
    assert.equal(predicateCalls, afterMount, 'the filtered talks were not recomputed');
  });
});

describe('copy', () => {
  test('mergeCopy keeps the default for keys set to undefined or null and leaves the defaults untouched', () => {
    const merged = mergeCopy({ rootLabel: undefined, noTalks: null, upcoming: 'Bald', resultCount: null });
    assert.equal(merged.rootLabel, 'Talks');
    assert.equal(merged.noTalks, 'No talks yet');
    assert.equal(merged.upcoming, 'Bald');
    assert.equal(merged.resultCount(1, 2), '1 of 2 talks');
    assert.equal(createDefaultCopy().upcoming, 'Upcoming', 'every call returns fresh defaults');
  });

  test('null copy keys from a serialized table keep the root label and do not crash the toolbar', async () => {
    const { container } = await mountElement(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, copy: { rootLabel: null, resultCount: null } }));
    assert.equal(container.querySelector('.wanderer')!.getAttribute('aria-label'), 'Talks');
    assert.equal(container.querySelector('.wanderer-toolbar__count span')!.textContent, '5 talks');
  });

  test('cards show online and hybrid badges, in-person talks none, and the clear button is labeled', async () => {
    const talks = [talk({ id: 'a', format: 'online' }), talk({ id: 'b', format: 'hybrid' }), talk({ id: 'c', format: 'in-person' })];
    const { dom, container } = await mountElement(createElement(Talks, { talks, copy: { online: 'Remote', hybrid: 'Both', clearSearch: 'Empty the field' } }));
    const cards = [...container.querySelectorAll('.wanderer-talk')];
    const badges = cards.map((card) => [...card.querySelectorAll('.wanderer-badge--muted')].map((node) => node.textContent).join(','));
    assert.deepEqual(badges.sort(), ['', 'Both', 'Remote']);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(search, 'talk', dom.window); });
    assert.equal(container.querySelector('.wanderer-search__clear')!.getAttribute('aria-label'), 'Empty the field');
    await act(async () => { click(container.querySelector('.wanderer-search__clear')!, dom.window); });
    assert.equal(search.value, '');
  });
});

describe('registerPlugins', () => {
  test('non-object entries fail with the contract message', () => {
    assert.throws(() => registerPlugins([{ id: 'a' }, false as never]), /entry 1 is false/);
    assert.throws(() => registerPlugins([null as never]), /entry 0 is null/);
    assert.throws(() => registerPlugins([{ id: 3 } as never]), /an object without a string id/);
  });
});

describe('public pieces used directly', () => {
  test('DEFAULT_BREAKPOINT, listView options and the list entry', () => {
    assert.equal(DEFAULT_BREAKPOINT, 1024);
    assert.equal(helpersEntry.DEFAULT_BREAKPOINT, 1024, 'the constant lives in the pure helpers module, so Server Components get the number');
    const view = listView({ label: 'Everything', heading: 'Every talk', order: 3 });
    assert.deepEqual([view.id, view.label, view.heading, view.order, view.Component], ['list', 'Everything', 'Every talk', 3, ListView]);
    assert.equal(listView().label, '', 'an empty label falls back to copy');
    for (const name of ['ListView', 'listView', 'TalkCard', 'Toolbar', 'TalkGroupSection', 'EmptyState', 'TalkLinkAnchor', 'resolveLinkPolicy', 'Heading']) {
      assert.ok(name in listEntry, `./list exports ${name}`);
    }
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, views: [listView({ label: 'Everything', heading: 'Every talk' })] }));
    assert.ok(html.includes('Every talk'));
  });

  test('Heading clamps its level to h1..h6', () => {
    assert.ok(renderToString(createElement(Heading, { level: 9 }, 'x')).startsWith('<h6'));
    assert.ok(renderToString(createElement(Heading, { level: 0 }, 'x')).startsWith('<h1'));
    assert.ok(renderToString(createElement(Heading, { level: 2.6 }, 'x')).startsWith('<h3'));
  });

  test('EmptyState, TalkCard, TalkGroupSection and Toolbar render from a captured context', async () => {
    const context = await captureContext();
    const empty = renderToString(createElement(EmptyState, { title: 'Nothing', description: 'Add some', action: createElement('button', null, 'Go') }));
    assert.ok(empty.includes('role="status"') && empty.includes('Nothing') && empty.includes('Add some') && empty.includes('<button>Go</button>'));
    const card = renderToString(createElement(TalkCard, { talk: FIXTURE_TALKS[0], context, upcoming: true }));
    assert.ok(card.includes(FIXTURE_TALKS[0].title) && card.includes('Upcoming'));
    const section = renderToString(createElement(TalkGroupSection, { group: context.groups[0], context }));
    const heading = /<h3[^>]* id="([^"]+)"/.exec(section)![1];
    assert.ok(section.includes(`aria-labelledby="${heading}"`), 'the section is named by its heading');
    const toolbar = renderToString(createElement(Toolbar, { context, activeView: 'list', shellKey: 'extra' }));
    assert.ok(toolbar.includes(`id="${context.instanceId}-extra-search"`), 'shellKey scopes the search id');
  });

  test('ErrorBoundary calls onError, shows the fallback, and resets when resetKey changes', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = () => {};
    cleanups.push(async () => { console.error = original; });
    let fail = true;
    const Flaky = () => { if (fail) throw new Error('flaky'); return createElement('p', { className: 'ok' }, 'ok'); };
    const element = (key: number) => createElement(ErrorBoundary, { fallback: createElement('p', { className: 'fallback' }, 'fallback'), resetKey: key, onError: (error: unknown) => errors.push(error) }, createElement(Flaky));
    const { container, root } = await mountElement(element(1));
    assert.ok(container.querySelector('.fallback'));
    assert.equal(errors.length, 1);
    fail = false;
    await act(async () => { root.render(element(1)); });
    assert.ok(container.querySelector('.fallback'), 'the same key keeps the fallback');
    await act(async () => { root.render(element(2)); });
    assert.ok(container.querySelector('.ok'), 'a new key retries');
  });

  test('useMediaQuery, useIsClient and useControllable', async () => {
    const seen: unknown[] = [];
    let setValue!: (next: number | ((previous: number) => number)) => void;
    const changes: number[] = [];
    function Probe() {
      seen.push([useMediaQuery(null), useMediaQuery('(min-width: 1024px)'), useIsClient()]);
      const [value, set] = useControllable<number>(undefined, 1, (next) => changes.push(next));
      setValue = set;
      return createElement('output', null, String(value));
    }
    assert.ok(renderToString(createElement(Probe)).includes('1'));
    assert.deepEqual(seen.at(-1), [undefined, undefined, false], 'no query, no measurement and not a client on the server');
    const { container } = await mountElement(createElement(Probe));
    assert.deepEqual(seen.at(-1), [undefined, true, true], 'the query resolves after mount at 1440px');
    await act(async () => { setValue((previous) => previous + 1); setValue((previous) => previous * 10); });
    assert.equal(container.querySelector('output')!.textContent, '20');
    assert.deepEqual(changes, [2, 20]);
  });

  test('useMediaQuery reports false where matchMedia is missing', async () => {
    const dom = installDom({ width: 1440 });
    delete (dom.window as unknown as { matchMedia?: unknown }).matchMedia;
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    let result: boolean | undefined;
    const Probe = () => { result = useMediaQuery('(min-width: 1px)'); return null; };
    await act(async () => { root.render(createElement(Probe)); });
    assert.equal(result, false);
  });
});
