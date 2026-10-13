import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Talks, useTalks } from '../src/index.js';
import { globeView } from '../src/globe.js';
import type { TalksProps, ViewChange } from '../src/component-types.js';
import { click, installDom, keydown, setInputValue, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { hydrateRoot } = await loadReactDomClient();

type Change = [string, ViewChange];

interface Mounted {
  dom: DomHandle;
  root: Root;
  section: HTMLElement;
  errors: string[];
  changes: Change[];
  rerender(props: Partial<TalksProps>): Promise<void>;
}

const mounted: Mounted[] = [];

afterEach(async () => {
  // Unmount every root before removing DOM globals; a later installDom() saved
  // the earlier globals as its "previous" state, so cleanup runs in reverse.
  const items = mounted.splice(0);
  for (const item of items) await act(async () => { item.root.unmount(); });
  for (const item of items.reverse()) item.dom.cleanup();
});

/** Server-renders, hydrates, and collects recoverable errors and view changes. */
async function hydrate(props: Partial<TalksProps>, options: { width?: number; prefersDark?: boolean } = {}): Promise<Mounted> {
  const dom = installDom({ width: options.width ?? 390, prefersDark: options.prefersDark });
  const changes: Change[] = [];
  const errors: string[] = [];
  let current: Partial<TalksProps> = props;
  const element = () => createElement(Talks, {
    talks: FIXTURE_TALKS,
    referenceDate: REFERENCE_DATE,
    onViewChange: (view, change) => { changes.push([view, change]); },
    ...current,
  });
  const container = dom.document.getElementById('root')!;
  container.innerHTML = renderToString(element());
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(container, element(), { onRecoverableError: (error) => { errors.push(String(error)); } });
  });
  const section = container.querySelector('.wanderer') as HTMLElement;
  const item: Mounted = {
    dom, root, section, errors, changes,
    async rerender(next) {
      current = { ...current, ...next };
      await act(async () => { root.render(element()); });
    },
  };
  mounted.push(item);
  return item;
}

const responsiveProps = (): Partial<TalksProps> => ({ views: [globeView()], responsive: { small: 'list', large: 'globe' } });
const viewButton = (section: Element, label: string) =>
  [...section.querySelectorAll<HTMLButtonElement>('.wanderer-views__button')].find((button) => button.textContent === label)!;
const shells = (section: Element) => [...section.querySelectorAll('.wanderer-shell')].map((shell) => shell.getAttribute('data-wanderer-shell'));

describe('hydration of the responsive layout', () => {
  for (const [width, expectedView] of [[390, 'list'], [1440, 'globe']] as const) {
    test(`at ${width}px hydrates without recoverable errors and settles on the ${expectedView} shell`, async () => {
      const { dom, section, errors, changes } = await hydrate(responsiveProps(), { width });
      assert.deepEqual(errors, []);
      assert.deepEqual(shells(section), ['active']);
      assert.equal(section.getAttribute('data-wanderer-view'), expectedView);
      assert.equal(section.hasAttribute('data-wanderer-view-small'), false);
      assert.equal(section.hasAttribute('data-wanderer-view-large'), false);
      assert.equal(section.getAttribute('data-wanderer-breakpoint'), '1024');
      assert.deepEqual(changes, [[expectedView, { reason: 'initial', previousView: undefined }]]);
      assert.equal(viewButton(section, expectedView === 'list' ? 'List' : 'Globe').getAttribute('aria-pressed'), 'true');
      assert.equal(dom.document.activeElement, dom.document.body, 'the initial resolution does not steal focus');
    });
  }

  test('server markup carries both shells and a custom breakpoint emits a scoped style', async () => {
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], responsive: { small: 'list', large: 'globe', breakpoint: 900 } }));
    assert.ok(html.includes('wanderer-shell--small') && html.includes('wanderer-shell--large'));
    assert.ok(html.includes('data-wanderer-breakpoint="900"'));
    assert.ok(html.includes('@media (min-width:900px)'));
    assert.ok(html.includes('@media (max-width:899.98px)'));
  });

  test('a breakpoint change switches the view with reason responsive while the user has not chosen', async () => {
    const { dom, section, changes } = await hydrate(responsiveProps(), { width: 390 });
    await act(async () => { dom.setWidth(1440); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.deepEqual(changes.at(-1), ['globe', { reason: 'responsive', previousView: 'list' }]);
    await act(async () => { dom.setWidth(800); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.deepEqual(changes.at(-1), ['list', { reason: 'responsive', previousView: 'globe' }]);
    assert.equal(changes.length, 3);
  });

  test('an explicit user choice is preserved across breakpoint changes', async () => {
    const { dom, section, changes } = await hydrate(responsiveProps(), { width: 390 });
    await act(async () => { click(viewButton(section, 'Globe'), dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.deepEqual(changes.at(-1), ['globe', { reason: 'user', previousView: 'list' }]);
    await act(async () => { dom.setWidth(1440); });
    await act(async () => { dom.setWidth(390); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe', 'resizing does not override the user');
    assert.equal(changes.length, 2);
  });

  test('clicking the other view fires reason user and moves focus to that view heading', async () => {
    const { dom, section, changes } = await hydrate(responsiveProps(), { width: 1440 });
    await act(async () => { click(viewButton(section, 'List'), dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.deepEqual(changes.at(-1), ['list', { reason: 'user', previousView: 'globe' }]);
    const heading = section.querySelector('.wanderer-view__heading')!;
    assert.ok(heading.id.endsWith('-view-list-heading'));
    assert.equal(dom.document.activeElement, heading);
    assert.equal(heading.getAttribute('tabindex'), '-1');
    assert.equal(viewButton(section, 'List').getAttribute('aria-pressed'), 'true');
    assert.equal(viewButton(section, 'Globe').getAttribute('aria-pressed'), 'false');
  });

  test('clicking the already active view does not fire onViewChange', async () => {
    const { dom, section, changes } = await hydrate(responsiveProps(), { width: 390 });
    await act(async () => { click(viewButton(section, 'List'), dom.window); });
    assert.equal(changes.length, 1);
  });

  test('the surviving shell keeps its server-rendered DOM and focus through hydration', async () => {
    const dom = installDom({ width: 1440 });
    const container = dom.document.getElementById('root')!;
    const element = () => createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, ...responsiveProps() });
    container.innerHTML = renderToString(element());
    const serverInput = container.querySelector<HTMLInputElement>('.wanderer-shell--large input[type="search"]')!;
    const serverList = container.querySelector('.wanderer-shell--large .wanderer-globe')!;
    serverInput.focus();
    assert.equal(dom.document.activeElement, serverInput, 'a visitor tabbed into the search box before JavaScript arrived');
    const errors: string[] = [];
    let root!: Root;
    await act(async () => { root = hydrateRoot(container, element(), { onRecoverableError: (error) => errors.push(String(error)) }); });
    try {
      assert.deepEqual(errors, []);
      const section = container.querySelector('.wanderer')!;
      assert.deepEqual(shells(section), ['active']);
      assert.ok(section.querySelector('.wanderer-shell')!.classList.contains('wanderer-shell--active'));
      assert.ok(container.contains(serverInput), 'the server-rendered input is still in the document');
      assert.equal(dom.document.activeElement, serverInput, 'focus survived hydration');
      assert.ok(container.contains(serverList), 'the server-rendered view subtree was kept, not rebuilt');
      assert.equal(serverInput.id, section.querySelector('label')!.htmlFor, 'the label still points at the input');
    } finally {
      await act(async () => { root.unmount(); });
      dom.cleanup();
    }
  });

  test('when both breakpoints resolve to the same view a single shell renders with unique ids', async () => {
    const props: Partial<TalksProps> = { ...responsiveProps(), enabledViews: ['list'] };
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, ...props }));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `server markup has duplicate ids: ${ids.join(', ')}`);
    assert.equal((html.match(/wanderer-shell /g) ?? []).length, 1, 'one shell');
    assert.equal(html.includes('wanderer-shell--small'), false);
    assert.equal(html.includes('wanderer-shell--large'), false);
    assert.ok(html.includes('data-wanderer-view-small="list"') && html.includes('data-wanderer-view-large="list"'));
    const { section, errors, changes } = await hydrate(props, { width: 1440 });
    assert.deepEqual(errors, []);
    assert.deepEqual(shells(section), ['active']);
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.deepEqual(changes, [['list', { reason: 'unavailable', previousView: undefined }]], 'the large request for the disabled globe is reported');
    const after = [...section.querySelectorAll('[id]')].map((node) => node.id);
    assert.equal(new Set(after).size, after.length);
  });
});

describe('Escape to list', () => {
  test('Escape on an element inside the root returns to the list and focuses its heading', async () => {
    const { dom, section, changes } = await hydrate(responsiveProps(), { width: 1440 });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    await act(async () => { keydown(viewButton(section, 'Globe'), 'Escape', dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.deepEqual(changes.at(-1), ['list', { reason: 'user', previousView: 'globe' }]);
    assert.equal(dom.document.activeElement?.id, section.querySelector('.wanderer-view__heading')?.id);
  });

  test('Escape is ignored while the list is active, when isModalOpen is true, when defaultPrevented, and when escapeToList is false', async () => {
    let modal = false;
    const first = await hydrate({ ...responsiveProps(), isModalOpen: () => modal }, { width: 1440 });
    modal = true;
    await act(async () => { keydown(viewButton(first.section, 'Globe'), 'Escape', first.dom.window); });
    assert.equal(first.section.getAttribute('data-wanderer-view'), 'globe', 'modal open');
    modal = false;
    await act(async () => { keydown(viewButton(first.section, 'Globe'), 'Escape', first.dom.window, { preventDefault: true }); });
    assert.equal(first.section.getAttribute('data-wanderer-view'), 'globe', 'defaultPrevented');
    await act(async () => { keydown(viewButton(first.section, 'Globe'), 'Escape', first.dom.window); });
    assert.equal(first.section.getAttribute('data-wanderer-view'), 'list', 'plain Escape still works afterwards');
    await act(async () => { keydown(viewButton(first.section, 'Globe'), 'Escape', first.dom.window); });
    assert.equal(first.changes.length, 2, 'Escape on the list is a no-op');

    const second = await hydrate({ ...responsiveProps(), escapeToList: false }, { width: 1440 });
    await act(async () => { keydown(viewButton(second.section, 'Globe'), 'Escape', second.dom.window); });
    assert.equal(second.section.getAttribute('data-wanderer-view'), 'globe', 'escapeToList false');
  });

  test('Escape inside a non-empty search input does not switch views, but does once the input is empty', async () => {
    const { dom, section } = await hydrate(responsiveProps(), { width: 1440 });
    const input = section.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(input, 'aurora', dom.window); });
    assert.equal(input.value, 'aurora');
    await act(async () => { keydown(input, 'Escape', dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    await act(async () => { setInputValue(input, '', dom.window); });
    await act(async () => { keydown(input, 'Escape', dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
  });

  test('Escape outside the root does nothing', async () => {
    const { dom, section } = await hydrate(responsiveProps(), { width: 1440 });
    await act(async () => { keydown(dom.document.body, 'Escape', dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
  });
});

describe('controlled props', () => {
  test('a controlled view reports clicks through onViewChange but only changes when the prop changes', async () => {
    const item = await hydrate({ views: [globeView()], view: 'list' }, { width: 1440 });
    const { dom, section, changes } = item;
    assert.deepEqual(changes, [['list', { reason: 'controlled', previousView: undefined }]]);
    await act(async () => { click(viewButton(section, 'Globe'), dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list', 'still controlled to list');
    assert.deepEqual(changes.slice(1), [['globe', { reason: 'user', previousView: 'list' }]]);
    await item.rerender({ view: 'globe' });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.equal(changes.length, 2, 'the consumer is not notified again for the view it just set');
    assert.equal(dom.document.activeElement?.id, section.querySelector('.wanderer-view__heading')?.id, 'focus follows the user-initiated controlled change');
    await item.rerender({ view: 'list' });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.equal(changes.length, 2, 'a plain controlled change is not echoed back');
  });

  test('an unavailable controlled view falls back to the first view with reason unavailable', async () => {
    const { section, changes } = await hydrate({ views: [globeView()], view: 'missing' }, { width: 1440 });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.deepEqual(changes, [['list', { reason: 'unavailable', previousView: undefined }]]);
  });

  test('a controlled view that becomes unavailable after mount is reported once, even when the shown view does not change', async () => {
    const item = await hydrate({ views: [globeView()], view: 'list' }, { width: 1440 });
    const { section, changes } = item;
    assert.deepEqual(changes, [['list', { reason: 'controlled', previousView: undefined }]]);
    await item.rerender({ view: 'nope' });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.deepEqual(changes.at(-1), ['list', { reason: 'unavailable', previousView: 'list' }], 'the consumer learns its request was rejected');
    assert.equal(changes.length, 2);
    await item.rerender({ view: 'nope', density: 'compact' });
    assert.equal(changes.length, 2, 'the same rejected request is not repeated');
    await item.rerender({ view: 'globe' });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.equal(changes.length, 2, 'an accepted controlled change is not echoed');
    await item.rerender({ view: 'nope' });
    assert.deepEqual(changes.at(-1), ['list', { reason: 'unavailable', previousView: 'globe' }]);
    await item.rerender({ view: 'list' });
    await item.rerender({ view: 'nope' });
    assert.equal(changes.length, 4, 'a request that became available and unavailable again is reported again');
  });

  test('controlled search and filters call back without changing until the props do', async () => {
    const searches: string[] = [];
    const filterChanges: (readonly string[])[] = [];
    const item = await hydrate({ search: '', filters: [], onSearchChange: (value) => searches.push(value), onFiltersChange: (value) => filterChanges.push(value) }, { width: 390 });
    const { dom, section } = item;
    const input = section.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(input, 'beacon', dom.window); });
    assert.deepEqual(searches, ['beacon']);
    assert.equal(input.value, '', 'controlled: unchanged until the prop changes');
    assert.equal(section.querySelectorAll('.wanderer-talk').length, FIXTURE_TALKS.length);
    await item.rerender({ search: 'beacon' });
    assert.equal(input.value, 'beacon');
    assert.equal(section.querySelectorAll('.wanderer-talk').length, 1);

    const chip = section.querySelector<HTMLButtonElement>('.wanderer-chip')!;
    await act(async () => { click(chip, dom.window); });
    assert.deepEqual(filterChanges, [['recording']]);
    assert.equal(chip.getAttribute('aria-pressed'), 'false');
    await item.rerender({ filters: ['recording'], search: '' });
    assert.equal(chip.getAttribute('aria-pressed'), 'true');
    assert.equal(section.querySelectorAll('.wanderer-talk').length, 2);
    const reset = [...section.querySelectorAll<HTMLButtonElement>('.wanderer-link-button')].find((button) => button.textContent === 'Reset search and filters')!;
    await act(async () => { click(reset, dom.window); });
    assert.deepEqual(searches.at(-1), '');
    assert.deepEqual(filterChanges.at(-1), []);
  });

  test('uncontrolled search filters immediately, shows the clear button, and the live region announces after the debounce', async () => {
    const { dom, section } = await hydrate({}, { width: 390 });
    const input = section.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(input, 'harbor', dom.window); });
    assert.equal(section.querySelectorAll('.wanderer-talk').length, 2);
    assert.equal(section.querySelector('.wanderer-toolbar__count span')?.textContent, '2 of 5 talks');
    const status = section.querySelector('[role="status"][aria-live="polite"]')!;
    assert.equal(status.textContent, '', 'not announced before the debounce');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    assert.equal(status.textContent, '2 of 5 talks');
    const clear = section.querySelector<HTMLButtonElement>('.wanderer-search__clear')!;
    await act(async () => { click(clear, dom.window); });
    assert.equal(input.value, '');
    assert.equal(section.querySelectorAll('.wanderer-talk').length, 5);
  });
});

describe('theme', () => {
  function SchemeProbe() {
    const context = useTalks();
    return createElement('output', { className: 'scheme-probe' }, context.colorScheme);
  }
  const schemeView = { id: 'scheme', label: 'Scheme', Component: SchemeProbe };

  test('data-wanderer-theme reflects the prop and colorScheme follows explicit themes', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { section, errors } = await hydrate({ theme, views: [schemeView], defaultView: 'scheme' }, { width: 390, prefersDark: theme === 'light' });
      assert.deepEqual(errors, []);
      assert.equal(section.getAttribute('data-wanderer-theme'), theme);
      assert.equal(section.querySelector('.scheme-probe')?.textContent, theme, 'explicit theme ignores the OS preference');
    }
  });

  test('system theme is light on the server and follows prefers-color-scheme after hydration, live', async () => {
    const html = renderToString(createElement(Talks, { talks: [], theme: 'system', views: [schemeView], defaultView: 'scheme' }));
    assert.ok(html.includes('<output class="scheme-probe">light</output>'));
    const { dom, section, errors } = await hydrate({ theme: 'system', views: [schemeView], defaultView: 'scheme' }, { width: 390, prefersDark: true });
    assert.deepEqual(errors, [], 'the server/client mismatch is resolved through useSyncExternalStore, not a hydration error');
    assert.equal(section.getAttribute('data-wanderer-theme'), 'system');
    assert.equal(section.querySelector('.scheme-probe')?.textContent, 'dark');
    await act(async () => { dom.setPrefersDark(false); });
    assert.equal(section.querySelector('.scheme-probe')?.textContent, 'light');
  });
});

describe('multiple instances', () => {
  test('two instances on one page have distinct ids, independent search state, and no duplicate element ids', async () => {
    const dom = installDom({ width: 1440 });
    const container = dom.document.getElementById('root')!;
    const page = () => createElement('div', null,
      createElement(Talks, { key: 'one', talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], responsive: { small: 'list', large: 'globe' } }),
      createElement(Talks, { key: 'two', talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], defaultView: 'list' }),
    );
    container.innerHTML = renderToString(page());
    const serverIds = [...container.querySelectorAll('[id]')].map((node) => node.id);
    assert.equal(new Set(serverIds).size, serverIds.length, `server markup has duplicate ids: ${serverIds.join(', ')}`);
    const errors: string[] = [];
    let root!: Root;
    await act(async () => { root = hydrateRoot(container, page(), { onRecoverableError: (error) => errors.push(String(error)) }); });
    try {
      assert.deepEqual(errors, []);
      const sections = [...container.querySelectorAll<HTMLElement>('.wanderer')];
      assert.equal(sections.length, 2);
      const [first, second] = sections;
      assert.notEqual(first.getAttribute('data-wanderer-instance'), second.getAttribute('data-wanderer-instance'));
      assert.equal(first.getAttribute('data-wanderer-view'), 'globe');
      assert.equal(second.getAttribute('data-wanderer-view'), 'list');
      const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
      assert.equal(new Set(ids).size, ids.length, `duplicate ids after hydration: ${ids.join(', ')}`);
      const secondInput = second.querySelector<HTMLInputElement>('input[type="search"]')!;
      await act(async () => { setInputValue(secondInput, 'cinder', dom.window); });
      assert.equal(second.querySelectorAll('.wanderer-talk').length, 1);
      assert.equal(first.querySelector<HTMLInputElement>('input[type="search"]')!.value, '');
      await act(async () => { click(viewButton(first, 'List'), dom.window); });
      assert.equal(first.querySelectorAll('.wanderer-talk').length, FIXTURE_TALKS.length, 'the first instance is unaffected by the second search');
      assert.equal(second.querySelectorAll('.wanderer-talk').length, 1);
    } finally {
      await act(async () => { root.unmount(); });
      dom.cleanup();
    }
  });
});
