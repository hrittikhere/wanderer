// Typing stays responsive with long lists: the search field and filter chips
// update in the urgent render, which skips the view, while filtering,
// grouping and the view follow in a deferred, interruptible render.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement } from 'react';
import { Talks } from '../src/index.js';
import type { SearchSlotProps, TalkViewProps } from '../src/component-types.js';
import { click, installDom, setInputValue } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('deferred filtering', () => {
  test('a keystroke updates the field first and renders the view once, with the filtered results', async () => {
    const fieldRenders: { value: string; talks: number }[] = [];
    const viewRenders: { search: string; filters: string; talks: number }[] = [];
    function RecordingField({ id, value, onChange, label, context }: SearchSlotProps) {
      fieldRenders.push({ value, talks: context.talks.length });
      return createElement('input', { id, type: 'search', value, 'aria-label': label, onChange: (event: { target: HTMLInputElement }) => onChange(event.target.value) });
    }
    function RecordingView({ context }: TalkViewProps) {
      viewRenders.push({ search: context.search, filters: context.filters.join(','), talks: context.talks.length });
      return null;
    }
    const dom = installDom({ width: 1440 });
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    const views = [{ id: 'record', label: 'Record', Component: RecordingView }];
    const slots = { SearchInput: RecordingField };
    await act(async () => {
      root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, defaultView: 'record', views, slots }));
    });
    const all = FIXTURE_TALKS.length;
    fieldRenders.length = 0;
    viewRenders.length = 0;
    const search = container.querySelector<HTMLInputElement>('.wanderer-toolbar__search input')!;
    await act(async () => { setInputValue(search, 'aurora', dom.window); });
    assert.deepEqual(fieldRenders[0], { value: 'aurora', talks: all }, 'the field shows the keystroke before the list is filtered');
    assert.deepEqual(fieldRenders.at(-1), { value: 'aurora', talks: 1 });
    assert.deepEqual(viewRenders, [{ search: 'aurora', filters: '', talks: 1 }], 'the view skips the urgent render and renders once');
    assert.equal(search.value, 'aurora');

    viewRenders.length = 0;
    const chip = [...container.querySelectorAll<HTMLButtonElement>('.wanderer-chip')].find((button) => button.textContent === 'With recording')!;
    await act(async () => { click(chip, dom.window); });
    assert.equal(chip.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(viewRenders, [{ search: 'aurora', filters: 'recording', talks: 1 }]);
  });
});
