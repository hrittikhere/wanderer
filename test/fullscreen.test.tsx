// Fullscreen dialog and Escape regressions. jsdom's HTMLDialogElement has no
// showModal, close or close watcher, so these tests drive the browser side by
// hand: a close request fires `cancel` (cancelable only while the page has
// history-action activation) and, unless prevented, removes `open` and fires
// `close`.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement, useState } from 'react';
import type { Root } from 'react-dom/client';
import { Talks } from '../src/index.js';
import { globeView } from '../src/globe.js';
import type { SearchSlotProps, TalkViewProps, TalksProps, ViewChange } from '../src/component-types.js';
import { click, installDom, setInputValue, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();

type Change = [string, ViewChange];

interface Mounted {
  dom: DomHandle;
  section: HTMLElement;
  changes: Change[];
  rerender(props: Partial<TalksProps>): Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function mount(props: Partial<TalksProps>): Promise<Mounted> {
  const dom = installDom({ width: 1440 });
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });
  const container = dom.document.getElementById('root')!;
  const changes: Change[] = [];
  let current = props;
  const element = () => createElement(Talks, {
    talks: FIXTURE_TALKS,
    referenceDate: REFERENCE_DATE,
    onViewChange: (view, change) => { changes.push([view, change]); },
    ...current,
  });
  let root!: Root;
  await act(async () => { root = createRoot(container); root.render(element()); });
  cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
  return {
    dom,
    section: container.querySelector('.wanderer') as HTMLElement,
    changes,
    async rerender(next) {
      current = { ...current, ...next };
      await act(async () => { root.render(element()); });
    },
  };
}

const viewButton = (section: Element, label: string) =>
  [...section.querySelectorAll<HTMLButtonElement>('.wanderer-views__button')].find((button) => button.textContent === label)!;

/** What a browser does for Escape inside a modal dialog once the keydown was not default-prevented. */
async function closeRequest(dialog: HTMLDialogElement, window: DomHandle['window'], cancelable: boolean): Promise<'kept' | 'closed'> {
  let kept = false;
  await act(async () => {
    const cancel = new window.Event('cancel', { cancelable });
    dialog.dispatchEvent(cancel);
    kept = cancel.defaultPrevented;
    if (kept) return;
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new window.Event('close'));
  });
  return kept ? 'kept' : 'closed';
}

async function escape(target: Element, window: DomHandle['window']): Promise<boolean> {
  let prevented = false;
  await act(async () => {
    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    prevented = event.defaultPrevented;
  });
  return prevented;
}

describe('fullscreen dialog closed by the browser', () => {
  const immersive = () => [globeView({ presentation: 'immersive' })];

  for (const [name, props] of [
    ['escapeToList is false', { escapeToList: false }],
    ['isModalOpen vetoes Escape', { isModalOpen: () => true }],
  ] as const) {
    test(`when ${name}, a forced close on the second Escape returns to the inline list`, async () => {
      const { dom, section, changes } = await mount({ views: immersive(), ...props });
      await act(async () => { click(viewButton(section, 'Globe'), dom.window); });
      const dialog = section.querySelector('dialog')!;
      assert.ok(dialog.hasAttribute('open'));
      const heading = dom.document.activeElement!;
      assert.equal(await escape(heading, dom.window), false, 'the root handler lets the close request through');
      assert.equal(await closeRequest(dialog, dom.window, true), 'kept', 'the first cancel is prevented');
      assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
      assert.ok(dialog.hasAttribute('open'));
      // Escape never grants user activation, so the next cancel cannot be prevented.
      assert.equal(await escape(heading, dom.window), false);
      assert.equal(await closeRequest(dialog, dom.window, false), 'closed');
      assert.equal(section.getAttribute('data-wanderer-view'), 'list', 'React state follows the closed dialog');
      assert.equal(section.querySelector('dialog'), null);
      assert.ok(section.querySelector('.wanderer-list'), 'the inline view and its toolbar are back');
      assert.deepEqual(changes.at(-1), ['list', { reason: 'user', previousView: 'globe' }]);
    });
  }

  test('a programmatic close leaves fullscreen, and a close event while still open is ignored', async () => {
    const { dom, section, changes } = await mount({ views: immersive(), defaultView: 'globe' });
    const dialog = section.querySelector('dialog')!;
    assert.ok(dialog.hasAttribute('open'));
    // A stale close event (for example from a close() that was followed by a reopen) changes nothing.
    await act(async () => { dialog.dispatchEvent(new dom.window.Event('close')); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.equal(changes.length, 1);
    await act(async () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new dom.window.Event('close')); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.equal(section.querySelector('dialog'), null);
  });

  test('a controlled parent that declines the exit gets the dialog back', async () => {
    const { dom, section, changes } = await mount({ views: immersive(), view: 'globe' });
    const dialog = section.querySelector('dialog')!;
    await act(async () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new dom.window.Event('close')); });
    assert.deepEqual(changes.at(-1), ['list', { reason: 'user', previousView: 'globe' }], 'the exit is requested');
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.equal(section.querySelector('dialog'), dialog);
    assert.ok(dialog.hasAttribute('open'), 'the shell does not stay hidden while the view is still fullscreen');
  });
});

describe('Escape inside inputs', () => {
  function Boxes({ context }: TalkViewProps) {
    const [text, setText] = useState('plugin text');
    return createElement('div', { className: 'boxes' },
      createElement('input', { type: 'checkbox', 'aria-label': 'Only talks' }),
      createElement('input', { type: 'range', 'aria-label': 'Year', min: 2020, max: 2030, defaultValue: 2025 }),
      createElement('input', { type: 'search', 'aria-label': 'Plugin search', className: 'plugin-search', value: text, onChange: (event: { target: HTMLInputElement }) => setText(event.target.value) }),
      createElement('output', null, context.search),
    );
  }
  const boxes = (presentation?: 'inline' | 'immersive') => ({ id: 'boxes', label: 'Boxes', presentation, Component: Boxes });

  for (const presentation of ['inline', 'immersive'] as const) {
    test(`Escape on a checkbox or range in a ${presentation} plugin view returns to the list`, async () => {
      for (const selector of ['input[type="checkbox"]', 'input[type="range"]']) {
        const { dom, section, changes } = await mount({ views: [boxes(presentation)], defaultView: 'boxes' });
        const input = section.querySelector<HTMLInputElement>(selector)!;
        assert.ok(input.value, `${selector} has an intrinsic value`);
        assert.equal(await escape(input, dom.window), true, 'the keydown is consumed by the view switch');
        assert.equal(section.getAttribute('data-wanderer-view'), 'list', selector);
        assert.deepEqual(changes.at(-1), ['list', { reason: 'user', previousView: 'boxes' }]);
      }
    });
  }

  test("Escape in a plugin's own search field leaves the Talks search alone", async () => {
    const searches: string[] = [];
    const { dom, section } = await mount({ views: [boxes()], defaultView: 'boxes', defaultSearch: 'aurora', onSearchChange: (value) => searches.push(value) });
    const own = section.querySelector<HTMLInputElement>('.plugin-search')!;
    const talksSearch = section.querySelector<HTMLInputElement>('.wanderer-search__input')!;
    assert.equal(await escape(own, dom.window), true, 'a text field with a value keeps Escape');
    assert.equal(section.getAttribute('data-wanderer-view'), 'boxes');
    assert.equal(talksSearch.value, 'aurora');
    assert.equal(own.value, 'plugin text');
    assert.deepEqual(searches, []);
  });

  test('a text-type SearchInput slot clears on the first Escape and switches views on the next', async () => {
    function TextSearch({ id, value, onChange, label }: SearchSlotProps) {
      return createElement('input', { id, type: 'text', value, 'aria-label': label, onChange: (event: { target: HTMLInputElement }) => onChange(event.target.value) });
    }
    const { dom, section } = await mount({ views: [globeView({ presentation: 'immersive' })], defaultView: 'globe', slots: { SearchInput: TextSearch } });
    const input = section.querySelector<HTMLInputElement>('.wanderer-toolbar__search input')!;
    assert.equal(input.type, 'text');
    await act(async () => { setInputValue(input, 'aurora', dom.window); });
    assert.equal(await escape(input, dom.window), true, 'the dialog stays open while the field clears');
    assert.equal(input.value, '');
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    assert.equal(await escape(input, dom.window), true);
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
  });
});

describe('view focus requests', () => {
  test('clicking the already active view leaves no focus request for a later controlled round trip', async () => {
    const item = await mount({ views: [globeView()], view: 'list' });
    const { dom, section } = item;
    const list = viewButton(section, 'List');
    list.focus();
    await act(async () => { click(list, dom.window); });
    assert.equal(item.changes.length, 1, 'no request for the view already shown');
    await item.rerender({ view: 'globe' });
    await item.rerender({ view: 'list' });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.equal(dom.document.activeElement, list, 'the consumer-driven change does not move focus');
  });
});

describe('globe presentation modifier', () => {
  test('a globe-only configuration that falls back inline is marked inline', async () => {
    const { section } = await mount({ views: [globeView({ presentation: 'immersive' })], enabledViews: ['globe'] });
    assert.equal(section.querySelector('dialog'), null);
    assert.ok(section.querySelector('.wanderer-globe--inline'));
    assert.equal(section.querySelector('.wanderer-globe--immersive'), null);
  });

  test('the fullscreen globe is marked immersive', async () => {
    const { section } = await mount({ views: [globeView({ presentation: 'immersive' })], defaultView: 'globe' });
    assert.ok(section.querySelector('dialog .wanderer-globe--immersive'));
  });
});

describe('fullscreen stylesheet', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'), 'utf8');

  test('the open-attribute fallback outside the top layer still stacks above the page', () => {
    const rule = /\n\.wanderer-shell--immersive \{([^}]*)\}/.exec(css);
    assert.ok(rule);
    assert.ok(rule[1].includes('z-index: var(--wanderer-z-overlay)'));
  });

  test('the scroll lock also covers hosts that scroll the body', () => {
    const rule = /([^{}]*)\{\s*overflow: hidden;\s*\}/g;
    const selectors = [...css.matchAll(rule)].map((match) => match[1].trim()).filter((selector) => selector.includes('wanderer-shell--immersive[open]'));
    assert.ok(selectors.some((selector) => selector.includes('html:has(.wanderer-shell--immersive[open]) body')), selectors.join(' | '));
  });
});
