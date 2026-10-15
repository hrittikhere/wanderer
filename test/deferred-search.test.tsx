// Typing stays responsive with long lists: the search field and filter chips
// update in the urgent render, while filtering, grouping and the list follow
// in a deferred, interruptible render.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Talks } from '../src/index.js';
import type { TalkViewProps } from '../src/component-types.js';
import { click, installDom, setInputValue } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('deferred filtering', () => {
  test('a keystroke and a chip render first with the previous results, then with the filtered ones', async () => {
    const renders: { search: string; filters: string; talks: number }[] = [];
    function RecordingView({ context }: TalkViewProps) {
      renders.push({ search: context.search, filters: context.filters.join(','), talks: context.talks.length });
      return null;
    }
    const dom = installDom({ width: 1440 });
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    await act(async () => {
      root.render(createElement(Talks, {
        talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, defaultView: 'record',
        views: [{ id: 'record', label: 'Record', Component: RecordingView }],
      }));
    });
    const all = FIXTURE_TALKS.length;
    renders.length = 0;
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(search, 'aurora', dom.window); });
    assert.deepEqual(renders[0], { search: 'aurora', filters: '', talks: all }, 'the field updates before the list is filtered');
    assert.deepEqual(renders.at(-1), { search: 'aurora', filters: '', talks: 1 }, 'the filtered list follows');
    assert.equal(search.value, 'aurora');

    renders.length = 0;
    const chip = [...container.querySelectorAll<HTMLButtonElement>('.wanderer-chip')].find((button) => button.textContent === 'With recording')!;
    await act(async () => { click(chip, dom.window); });
    assert.equal(chip.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(renders[0], { search: 'aurora', filters: 'recording', talks: 1 }, 'the chip is pressed before the list is filtered');
    assert.equal(renders.at(-1)?.filters, 'recording');
  });
});
