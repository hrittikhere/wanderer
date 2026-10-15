// Behavior of TalksProps that other suites do not exercise, plus regressions for
// root state: filter composition, predicate and slot containment, the result
// announcement, onValidation, view registration errors and trackpad gestures.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement, useState, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { ListView, TalkGroupSection, Talks, definePlugin } from '../src/index.js';
import { globeView } from '../src/globe.js';
import type {
  GlobeAsideProps, GlobeOverlayCardProps, ImageComponentProps, Milestone, SearchSlotProps, TalkRendererProps,
  TalkViewProps, TalksProps, ViewChange,
} from '../src/component-types.js';
import type { ValidationResult } from '../src/types.js';
import { click, installDom, setInputValue, wait, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { installFakeWebGl } from './support/webgl.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

interface Mounted {
  dom: DomHandle;
  root: Root;
  container: HTMLElement;
  readonly section: HTMLElement;
  render(next?: Partial<TalksProps>): Promise<void>;
}

async function mount(props: Partial<TalksProps> = {}, width = 1440): Promise<Mounted> {
  const dom = installDom({ width });
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
  let current = props;
  const render = async (next: Partial<TalksProps> = {}) => {
    current = { ...current, ...next };
    await act(async () => { root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, ...current } as TalksProps)); });
  };
  await render();
  return { dom, root, container, render, get section() { return container.querySelector<HTMLElement>('.wanderer')!; } };
}

/** Mounts an arbitrary element (for parents that own state) on a fresh DOM. */
async function mountElement(element: ReactNode): Promise<{ dom: DomHandle; container: HTMLElement }> {
  const dom = installDom({ width: 1440 });
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
  await act(async () => { root.render(element); });
  return { dom, container };
}

async function silenced<T>(run: (errors: unknown[][]) => Promise<T> | T): Promise<T> {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    return await run(errors);
  } finally {
    console.error = original;
  }
}

const chips = (section: Element) => [...section.querySelectorAll<HTMLButtonElement>('.wanderer-chip')];
const chipState = (section: Element) => chips(section).map((chip) => `${chip.textContent}=${chip.getAttribute('aria-pressed')}`);
const chip = (section: Element, label: string) => chips(section).find((item) => item.textContent === label)!;
const titles = (section: Element) => [...section.querySelectorAll('.wanderer-talk__title')].map((node) => node.textContent);
const count = (section: Element) => section.querySelector('.wanderer-toolbar__count span')?.textContent;
const resetLink = (section: Element) => [...section.querySelectorAll('.wanderer-link-button')].find((button) => button.textContent === 'Reset search and filters');
const status = (section: Element) => section.querySelector('[role="status"][aria-live="polite"]')!;
const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);

describe('filters props', () => {
  test('builtinFilters drops unknown ids, collapses duplicates, keeps built-in order, and the chips filter', async () => {
    const item = await mount({ builtinFilters: ['hybrid', 'recording', 'recording', 'bogus' as never, 'online'] });
    assert.deepEqual(chips(item.section).map((node) => node.textContent), ['With recording', 'Online', 'Hybrid']);
    await act(async () => { click(chip(item.section, 'Hybrid'), item.dom.window); });
    assert.deepEqual(titles(item.section), ['Dune Storage Internals']);
    assert.equal(count(item.section), '1 of 5 talks');
    await item.render({ builtinFilters: [] });
    assert.equal(item.section.querySelector('.wanderer-filters'), null, 'no chip group without built-in or plugin filters');
  });

  test('defaultFilters seeds the pressed chips and the filtered list', async () => {
    const item = await mount({ defaultFilters: ['recording'] });
    assert.deepEqual(chipState(item.section), ['With recording=true', 'Upcoming only=false']);
    assert.equal(count(item.section), '2 of 5 talks');
    assert.ok(resetLink(item.section));
  });

  test('an active id that no offered chip or plugin filter matches has no effect', async () => {
    const changes: (readonly string[])[] = [];
    const item = await mount({ defaultFilters: ['online'], onFiltersChange: (next) => changes.push(next) });
    assert.equal(count(item.section), '5 talks');
    assert.deepEqual(chipState(item.section), ['With recording=false', 'Upcoming only=false']);
    assert.equal(resetLink(item.section), undefined);
    await act(async () => { click(chip(item.section, 'With recording'), item.dom.window); });
    assert.deepEqual(changes, [['online', 'recording']], 'the inert id stays in the array');
  });

  test('two toggleFilter calls in one handler compose (uncontrolled)', async () => {
    const changes: (readonly string[])[] = [];
    const preset = definePlugin({
      id: 'preset',
      actions: [{ id: 'upcoming-recordings', label: 'Upcoming recordings', onAction: (_talk, context) => { context.toggleFilter('recording'); context.toggleFilter('upcoming'); } }],
    });
    const item = await mount({ plugins: [preset], onFiltersChange: (next) => changes.push(next) });
    const button = item.section.querySelector<HTMLButtonElement>('button.wanderer-action')!;
    await act(async () => { click(button, item.dom.window); });
    assert.deepEqual(chipState(item.section), ['With recording=true', 'Upcoming only=true']);
    assert.deepEqual(changes, [['recording'], ['recording', 'upcoming']]);
    assert.deepEqual(titles(item.section), ['Dune Storage Internals']);
  });

  test('two toggleFilter calls in one handler compose for a controlled parent', async () => {
    const preset = definePlugin({
      id: 'preset',
      actions: [{ id: 'upcoming-recordings', label: 'Upcoming recordings', onAction: (_talk, context) => { context.toggleFilter('recording'); context.toggleFilter('upcoming'); } }],
    });
    const plugins = [preset];
    function Parent() {
      const [filters, setFilters] = useState<readonly string[]>([]);
      return createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, plugins, filters, onFiltersChange: setFilters });
    }
    const { dom, container } = await mountElement(createElement(Parent));
    await act(async () => { click(container.querySelector('button.wanderer-action')!, dom.window); });
    assert.deepEqual(chipState(container), ['With recording=true', 'Upcoming only=true']);
  });

  test('a controlled change the parent declines is not carried into the next toggle', async () => {
    const changes: (readonly string[])[] = [];
    const item = await mount({ filters: [], onFiltersChange: (next) => changes.push(next) });
    await act(async () => { click(chip(item.section, 'With recording'), item.dom.window); });
    await act(async () => { click(chip(item.section, 'Upcoming only'), item.dom.window); });
    assert.deepEqual(changes, [['recording'], ['upcoming']]);
    assert.deepEqual(chipState(item.section), ['With recording=false', 'Upcoming only=false']);
  });

  test('a lone combining accent is not an active search: no reset link and no announcement', async () => {
    const item = await mount({ defaultSearch: '´' });
    assert.equal(item.section.querySelectorAll('.wanderer-talk').length, 5);
    assert.equal(resetLink(item.section), undefined);
    await act(async () => { await wait(650); });
    assert.equal(status(item.section).textContent, '');
  });

  test('grouping is wired to the list groups', async () => {
    const item = await mount();
    assert.ok(item.section.querySelector('[data-wanderer-group="upcoming"]'));
    await item.render({ grouping: 'none' });
    assert.equal(item.section.querySelector('[data-wanderer-group="upcoming"]'), null);
    assert.deepEqual([...item.section.querySelectorAll('[data-wanderer-group]')].map((node) => node.getAttribute('data-wanderer-group')), ['year-2031', 'year-2030', 'year-2029']);
  });
});

describe('plugin failures stay contained', () => {
  test('a filter predicate that throws excludes those talks, logs once, and keeps the component mounted', async () => {
    await silenced(async (errors) => {
      const tagged = definePlugin({
        id: 'tagged',
        filters: [{ id: 'batch', label: 'Batch', predicate: (item) => { if (!item.tags) throw new Error('no tags'); return item.tags.includes('batch'); } }],
      });
      const item = await mount({ plugins: [tagged] });
      await act(async () => { click(chip(item.section, 'Batch'), item.dom.window); });
      assert.ok(item.container.querySelector('.wanderer'), 'the root is still mounted');
      assert.deepEqual(titles(item.section), ['Aurora Scheduling at Scale']);
      assert.equal(count(item.section), '1 of 5 talks');
      assert.equal(errors.length, 1, 'reported once per computation, not once per talk');
      assert.match(String(errors[0][0]), /Filter "batch" threw/);
    });
  });

  test('a SearchInput slot that throws is replaced by the pluginError copy and the rest keeps working', async () => {
    await silenced(async () => {
      function Fragile({ id, value, onChange, label }: SearchSlotProps) {
        if (value === 'boom') throw new Error('slot exploded');
        return createElement('input', { id, value, 'aria-label': label, className: 'fragile', onChange: (event: { target: { value: string } }) => onChange(event.target.value) });
      }
      const item = await mount({ slots: { SearchInput: Fragile } });
      const input = item.section.querySelector<HTMLInputElement>('input.fragile')!;
      await act(async () => { setInputValue(input, 'boom', item.dom.window); });
      assert.ok(item.container.querySelector('.wanderer'), 'the root is still mounted');
      assert.equal(item.section.querySelector('.wanderer-toolbar__search .wanderer-error')?.textContent, 'This part of the page failed to render.');
      assert.equal(count(item.section), '0 of 5 talks');
      await act(async () => { click(chip(item.section, 'With recording'), item.dom.window); });
      assert.equal(chip(item.section, 'With recording').getAttribute('aria-pressed'), 'true', 'the toolbar still works');
    });
  });
});

describe('result announcement', () => {
  test('a parent re-rendering with an inline copy literal does not restart the debounce', async () => {
    const item = await mount({ copy: { noTalks: 'Nothing yet' } }, 390);
    const input = item.section.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(input, 'harbor', item.dom.window); });
    for (let tick = 0; tick < 4; tick += 1) {
      await act(async () => { await wait(200); });
      await item.render({ copy: { noTalks: 'Nothing yet' } });
    }
    assert.equal(status(item.section).textContent, '2 of 5 talks');
  });

  test('the delayed announcement does not re-render the talk cards', async () => {
    let renders = 0;
    function Counting({ talk: item }: TalkRendererProps) {
      renders += 1;
      return createElement('div', { className: 'counted' }, item.title);
    }
    const counting = definePlugin({ id: 'counting', renderers: [{ id: 'counting', Component: Counting }] });
    const item = await mount({ plugins: [counting] }, 390);
    renders = 0;
    const input = item.section.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { setInputValue(input, 'harbor', item.dom.window); });
    assert.equal(renders, 2, 'the two matching cards render once for the keystroke');
    await act(async () => { await wait(650); });
    assert.equal(status(item.section).textContent, '2 of 5 talks');
    assert.equal(renders, 2, 'the announcement firing renders no card');
  });
});

describe('onValidation and onViewChange', () => {
  const invalid = [talk({ id: 'same', title: 'First' }), talk({ id: 'same', title: 'Second' })];

  test('fires once on mount, not for a new callback identity, and again when the result changes', async () => {
    const calls: ValidationResult[] = [];
    const item = await mount({ talks: invalid, onValidation: (result) => { calls.push(result); } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].errors.map((error) => error.code), ['duplicate_id']);
    for (let render = 0; render < 5; render += 1) await item.render({ onValidation: (result) => { calls.push(result); }, density: render % 2 ? 'compact' : 'comfortable' });
    assert.equal(calls.length, 1, 'unrelated parent renders with an inline callback do not re-fire it');
    await item.render({ validation: 'strict' });
    assert.equal(calls.length, 2, 'a validation mode change produces a new result');
  });

  test('onValidation does not loop when the parent stores the result and passes a stable talks array', async () => {
    let renders = 0;
    function Parent() {
      const [result, setResult] = useState<ValidationResult | null>(null);
      renders += 1;
      return createElement('div', null,
        createElement('p', { className: 'banner' }, result ? `${result.errors.length} errors` : ''),
        createElement(Talks, { talks: invalid, referenceDate: REFERENCE_DATE, onValidation: (next) => setResult(next) }));
    }
    const { container } = await mountElement(createElement(Parent));
    assert.equal(container.querySelector('.banner')?.textContent, '1 errors');
    assert.ok(renders <= 3, `rendered ${renders} times`);
  });

  test('the strict validation alert reports no view until the data becomes valid', async () => {
    const changes: [string, ViewChange][] = [];
    const item = await mount({ talks: [talk({ id: 'ok' }), talk({ id: 'bad', date: 'nope' })], validation: 'strict', onViewChange: (view, change) => { changes.push([view, change]); } });
    assert.ok(item.section.matches('[role="alert"]'));
    assert.deepEqual(changes, []);
    await item.render({ talks: [talk({ id: 'ok' })] });
    assert.deepEqual(changes, [['list', { reason: 'initial', previousView: undefined }]]);
  });
});

describe('view registration', () => {
  const Probe = () => createElement('p', null, 'probe');

  test('enabledViews that matches no registered view throws instead of rendering the empty-dataset copy', () => {
    assert.throws(() => renderToString(createElement(Talks, { talks: FIXTURE_TALKS, views: [globeView()], enabledViews: ['Globe'] })), /enabledViews matches no registered view: \[Globe\]/);
    assert.throws(() => renderToString(createElement(Talks, { talks: FIXTURE_TALKS, enabledViews: [] })), /enabledViews matches no registered view: \[\]/);
  });

  test('duplicate ids inside the views prop throw; replacing the built-in list still works', () => {
    assert.throws(
      () => renderToString(createElement(Talks, { talks: FIXTURE_TALKS, views: [{ id: 'dup', label: 'A', Component: Probe }, { id: 'dup', label: 'B', Component: Probe }] })),
      /Duplicate or reserved plugin\/contribution ID: dup/,
    );
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, views: [{ id: 'list', label: 'Mine', Component: Probe }] }));
    assert.ok(html.includes('<p>probe</p>'));
  });

  test('a view id with inner whitespace throws because it becomes a DOM id and an IDREF', () => {
    assert.throws(
      () => renderToString(createElement(Talks, { talks: FIXTURE_TALKS, plugins: [definePlugin({ id: 'p', views: [{ id: 'my view', label: 'Mine', presentation: 'immersive', Component: Probe }] })] })),
      /View IDs must not contain whitespace: my view/,
    );
    assert.throws(() => renderToString(createElement(Talks, { talks: FIXTURE_TALKS, views: [{ id: 'tab\tview', label: 'Tab', Component: Probe }] })), /whitespace/);
    assert.doesNotThrow(() => renderToString(createElement(Talks, { talks: FIXTURE_TALKS, plugins: [definePlugin({ id: 'p', filters: [{ id: 'has space', label: 'x', predicate: () => true }] })] })), 'only view ids reach the DOM');
  });

  test('list pieces composed in a second view keep group ids unique across responsive shells', () => {
    const compact = { id: 'compact', label: 'Compact', Component: (props: TalkViewProps) => createElement(ListView, props) };
    const sections = {
      id: 'sections',
      label: 'Sections',
      Component: ({ context }: TalkViewProps) => createElement('div', null, context.groups.map((group) => createElement(TalkGroupSection, { key: group.id, group, context }))),
    };
    for (const view of [compact, sections]) {
      const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [view], responsive: { small: 'list', large: view.id } }));
      const all = ids(html);
      assert.equal(new Set(all).size, all.length, `${view.id}: duplicate ids ${all.join(', ')}`);
      for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(all.includes(match[1]), `${match[1]} resolves`);
    }
  });
});

describe('presentation props', () => {
  test('viewHeadings visually-hidden keeps the heading as a focus target', async () => {
    const item = await mount({ viewHeadings: 'visually-hidden' });
    const heading = item.section.querySelector('.wanderer-view__heading')!;
    assert.ok(heading.classList.contains('wanderer-visually-hidden'));
    assert.ok(heading.classList.contains('wanderer-visually-hidden--focusable'));
    assert.equal(heading.getAttribute('tabindex'), '-1');
    await item.render({ viewHeadings: 'visible' });
    assert.equal(item.section.querySelector('.wanderer-view__heading')!.classList.contains('wanderer-visually-hidden'), false);
  });

  test('style is merged after tokens and wins on a collision', async () => {
    const item = await mount({ tokens: { '--wanderer-accent': '#111111', '--wanderer-radius': '4px' }, style: { '--wanderer-accent': '#222222', color: 'red' } as never });
    assert.equal(item.section.style.getPropertyValue('--wanderer-accent'), '#222222');
    assert.equal(item.section.style.getPropertyValue('--wanderer-radius'), '4px');
    assert.equal(item.section.style.color, 'red');
  });
});

describe('trackpad gestures', () => {
  const wideView = (id: string, order: number) => ({
    id, order, label: id,
    Component: () => createElement('div', { className: `${id}-body` },
      createElement('div', { className: 'wide', style: { overflowX: 'auto' } }, createElement('span', { className: 'wide-child' }, 'wide content'))),
  });
  const views = [wideView('probe', 5), wideView('probe2', 6)];

  function wheel(target: Element, dom: DomHandle, deltaX: number, timeStamp: number, deltaY = 0) {
    const event = new dom.window.WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    target.dispatchEvent(event);
    return event;
  }

  async function mountGestures(props: Partial<TalksProps> = {}) {
    const changes: [string, ViewChange][] = [];
    const item = await mount({ views, trackpadGestures: true, onViewChange: (view, change) => { changes.push([view, change]); }, ...props });
    const target = () => item.section.querySelector('.wanderer-view__heading')!;
    const swipe = async (deltaX: number, timeStamp: number, deltaY = 0, on: Element = target()) => {
      let event!: Event;
      await act(async () => { event = wheel(on, item.dom, deltaX, timeStamp, deltaY); });
      return event;
    };
    return { ...item, changes, swipe, view: () => item.section.getAttribute('data-wanderer-view') };
  }

  test('off by default', async () => {
    const item = await mountGestures({ trackpadGestures: undefined });
    await act(async () => { wheel(item.section.querySelector('.wanderer-view__heading')!, item.dom, 200, 1000); });
    assert.equal(item.view(), 'list');
  });

  test('accumulates 110 px in registry order, never prevents scrolling, focuses the heading, and honors the cooldown', async () => {
    const item = await mountGestures();
    await item.swipe(60, 1000);
    assert.equal(item.view(), 'list');
    const event = await item.swipe(60, 1016);
    assert.equal(item.view(), 'probe');
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(item.changes.at(-1), ['probe', { reason: 'user', previousView: 'list' }]);
    assert.ok(item.dom.document.activeElement?.id.endsWith('-view-probe-heading'));
    await item.swipe(120, 1300);
    assert.equal(item.view(), 'probe', 'within the 700 ms cooldown');
    await item.swipe(-120, 2000);
    assert.equal(item.view(), 'list', 'a negative swipe goes back');
  });

  test('RTL inverts the direction', async () => {
    const item = await mountGestures({ direction: 'rtl' });
    await item.swipe(120, 1000);
    assert.equal(item.view(), 'probe2', 'a positive delta steps backwards in RTL');
  });

  test('ignores vertical-dominant and sub-threshold deltas, and a consumer modal vetoes it', async () => {
    let modal = true;
    const item = await mountGestures({ isModalOpen: () => modal });
    await item.swipe(200, 1000);
    assert.equal(item.view(), 'list', 'modal open');
    modal = false;
    for (let index = 0; index < 10; index += 1) await item.swipe(40, 2000 + index * 16, 80);
    for (let index = 0; index < 40; index += 1) await item.swipe(3, 3000 + index * 16);
    assert.equal(item.view(), 'list');
  });

  test('a pause between wheel events starts a new gesture', async () => {
    const item = await mountGestures();
    await item.swipe(60, 1000);
    await item.swipe(60, 1000 + 5 * 60_000);
    assert.equal(item.view(), 'list', 'two nudges five minutes apart are not one swipe');
    await item.swipe(60, 1000 + 5 * 60_000 + 16);
    assert.equal(item.view(), 'probe');
  });

  test('wheel input over a horizontally scrollable descendant belongs to that element', async () => {
    const item = await mountGestures({ defaultView: 'probe' });
    const wide = item.section.querySelector<HTMLElement>('.wide')!;
    Object.defineProperty(wide, 'scrollWidth', { configurable: true, value: 5000 });
    Object.defineProperty(wide, 'clientWidth', { configurable: true, value: 300 });
    for (let index = 0; index < 3; index += 1) await item.swipe(40, 1000 + index * 16, 0, item.section.querySelector('.wide-child')!);
    assert.equal(item.view(), 'probe');
    for (let index = 0; index < 3; index += 1) await item.swipe(40, 2000 + index * 16);
    assert.equal(item.view(), 'probe2', 'the same swipe outside the scroller still switches');
  });
});

describe('globe props: milestones, ImageComponent and slots', () => {
  async function mountGlobe(props: Partial<TalksProps>) {
    const dom = installDom({ width: 1440, reducedMotion: true });
    const gl = installFakeWebGl(dom);
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); gl.cleanup(); dom.cleanup(); });
    let current: Partial<TalksProps> = { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView({ intro: false, autoRotate: false })], defaultView: 'globe', ...props };
    const render = async (next: Partial<TalksProps> = {}) => {
      current = { ...current, ...next };
      await act(async () => { root.render(createElement(Talks, current as TalksProps)); });
    };
    await render();
    const globe = container.querySelector<HTMLElement>('.wanderer-globe')!;
    for (let attempt = 0; attempt < 50 && globe.getAttribute('data-wanderer-globe-status') !== 'ready'; attempt += 1) {
      await act(async () => { await wait(5); });
    }
    assert.equal(globe.getAttribute('data-wanderer-globe-status'), 'ready');
    const select = async (id: string) => {
      const element = globe.querySelector<HTMLSelectElement>('.wanderer-globe__milestones select')!;
      await act(async () => { element.value = id; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    };
    return { dom, globe, render, select };
  }

  const milestones: Milestone[] = [
    { id: 'by-talk', title: 'Harbor stage', talkId: 'beacon-2029', image: { src: '/photo.svg', alt: 'The stage', width: 40, height: 30 } },
    { id: 'orphan', title: 'Orphan', talkId: 'missing' },
    { id: 'unmapped', title: 'Online only', talkId: 'cinder-online' },
  ];

  function CustomImage({ src, alt, width, height, loading, decoding, className }: ImageComponentProps) {
    return createElement('img', { src, alt, width, height, loading, decoding, className, 'data-custom': 'yes' });
  }
  const Aside = ({ geography }: GlobeAsideProps) => createElement('p', { className: 'aside-slot' }, `${geography.markers.length} markers`);
  const Overlay = ({ geography }: GlobeAsideProps) => createElement('p', { className: 'overlay-slot' }, `${geography.mappedCount} mapped`);
  const Card = ({ milestone }: GlobeOverlayCardProps) => createElement('p', { className: 'card-slot' }, milestone.title);

  test('talkId milestones resolve coordinates, the default card uses ImageComponent, and the aside and stage slots render', async () => {
    const item = await mountGlobe({ milestones, ImageComponent: CustomImage, slots: { GlobeAside: Aside, GlobeStageOverlay: Overlay } });
    const options = [...item.globe.querySelectorAll('.wanderer-globe__milestones option')].map((option) => option.getAttribute('value'));
    assert.deepEqual(options, ['', 'by-talk'], 'milestones that resolve no coordinates are dropped');
    assert.equal(item.globe.querySelector('.wanderer-globe__panel-scroll .aside-slot')?.textContent, '3 markers');
    assert.equal(item.globe.querySelector('.wanderer-globe__overlay .overlay-slot')?.textContent, '4 mapped');
    await item.select('by-talk');
    const callout = item.globe.querySelector('.wanderer-globe__callout[data-wanderer-milestone="by-talk"]')!;
    const image = callout.querySelector('img')!;
    assert.equal(image.getAttribute('data-custom'), 'yes');
    assert.equal(image.getAttribute('src'), '/photo.svg');
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.equal(image.getAttribute('decoding'), 'async');
    assert.equal(image.className, 'wanderer-milestone__image');
    const photo = callout.querySelector('a.wanderer-milestone__photo')!;
    assert.equal(photo.getAttribute('href'), '/photo.svg');
    assert.equal(photo.getAttribute('target'), '_blank');
    assert.equal(photo.textContent, 'View full photo');
  });

  test('slots.GlobeOverlayCard replaces the default card and keeps the dismiss button', async () => {
    const item = await mountGlobe({ milestones, slots: { GlobeOverlayCard: Card } });
    await item.select('by-talk');
    const callout = item.globe.querySelector('.wanderer-globe__callout')!;
    assert.equal(callout.querySelector('.card-slot')?.textContent, 'Harbor stage');
    assert.equal(callout.querySelector('.wanderer-milestone'), null);
    assert.ok(callout.querySelector('.wanderer-globe__dismiss'));
  });
});
