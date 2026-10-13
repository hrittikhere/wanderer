import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Talks } from '../src/index.js';
import { globeView } from '../src/globe.js';
import { facingPhi, projectMarker } from '../src/globe/projection.js';
import { formatCalendarDate, groupTalks, sortTalks } from '../src/helpers.js';
import { click, installDom } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { installFakeWebGl } from './support/webgl.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const { createRoot, hydrateRoot } = await loadReactDomClient();

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);
const yearFormat = (locale: string) => new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' });
const headings = (html: string) =>
  [...html.matchAll(/class="wanderer-group__title"[^>]*>(?:<span[^>]*><\/span>)?([^<]*)</g)].map((match) => match[1]);

/** Counts constructions of a global constructor while `run` executes. */
function countConstructions<K extends 'Date' | 'DateTimeFormat'>(kind: K, run: () => void): number {
  let count = 0;
  if (kind === 'Date') {
    const Real = globalThis.Date;
    globalThis.Date = class extends Real {
      constructor(...args: unknown[]) { super(...(args as [])); count += 1; }
    } as DateConstructor;
    try { run(); } finally { globalThis.Date = Real; }
  } else {
    const Real = Intl.DateTimeFormat;
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = class extends Real {
      constructor(...args: ConstructorParameters<typeof Real>) { super(...args); count += 1; }
    };
    try { run(); } finally { (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real; }
  }
  return count;
}

describe('year labels follow the locale', () => {
  const dated = [
    talk({ id: 'a', date: '2030-03-10' }),
    talk({ id: 'b', date: '2029-01-05' }),
    talk({ id: 'c', date: '2029-06-01' }),
    talk({ id: 'undated', date: '' }),
  ];

  test('groupTalks keeps Gregorian year labels without a locale and localizes them with one', () => {
    assert.deepEqual(groupTalks(dated, {}).map((group) => group.label), ['2030', '2029', 'Undated']);
    assert.equal(new Intl.DateTimeFormat('th-TH').resolvedOptions().calendar, 'buddhist', 'th-TH defaults to the Buddhist calendar');
    const thai = groupTalks(dated, { locale: 'th-TH' });
    assert.deepEqual(thai.map((group) => group.id), ['year-2030', 'year-2029', 'undated'], 'ids stay Gregorian');
    assert.deepEqual(thai.map((group) => group.label), [
      yearFormat('th-TH').format(utc('2030-03-10')), yearFormat('th-TH').format(utc('2029-06-01')), 'Undated',
    ]);
    assert.ok(thai[0].label.includes('2573'), 'the Buddhist year, as on the card dates');
    assert.equal(groupTalks(dated, { locale: 'en-US' })[0].label, '2030');
  });

  test('a Gregorian year that spans two years of the locale calendar is labeled as a range', () => {
    const persian = yearFormat('fa-IR');
    assert.notEqual(persian.format(utc('2029-01-05')), persian.format(utc('2029-06-01')), 'precondition: two Persian years');
    const groups = groupTalks(dated, { locale: 'fa-IR' });
    assert.equal(groups[1].id, 'year-2029');
    assert.equal(groups[1].label, persian.formatRange(utc('2029-01-05'), utc('2029-06-01')));
    assert.equal(groups[0].label, persian.format(utc('2030-03-10')), 'a single year stays a single year');
  });

  test('the list renders year headings in the same calendar and digits as the card dates', () => {
    for (const locale of ['th-TH', 'ar-EG', 'ja-JP', 'en-US']) {
      const html = renderToString(createElement(Talks, { talks: dated, referenceDate: '2031-01-01', locale }));
      const format = yearFormat(locale);
      assert.deepEqual(headings(html), [
        format.format(utc('2030-03-10')),
        format.formatRange(utc('2029-01-05'), utc('2029-06-01')),
        'Undated',
      ], locale);
      assert.ok(html.includes('data-wanderer-group="year-2030"'), `${locale} keeps the Gregorian group id`);
    }
  });

  test('the globe location list formats the latest year in the locale', () => {
    const html = renderToString(createElement(Talks, {
      talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, locale: 'ar-EG', views: [globeView()], defaultView: 'globe',
    }));
    const latest = yearFormat('ar-EG').format(utc('2029-11-02'));
    assert.notEqual(latest, '2029', 'precondition: ar-EG uses Arabic-Indic digits');
    assert.ok(html.includes(`Latest<!-- -->: <!-- -->${latest}`), 'Lisbon shows the localized latest year');
  });

  test('the globe hover tooltip formats the latest year in the locale', async () => {
    const dom = installDom({ width: 1440, reducedMotion: true });
    const gl = installFakeWebGl(dom);
    // The renderer reads the stage size from clientWidth/Height, which jsdom reports as 0.
    for (const name of ['clientWidth', 'clientHeight']) {
      Object.defineProperty(dom.window.HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) { return this.classList.contains('wanderer-globe__scene') ? 400 : 0; },
      });
    }
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, locale: 'ar-EG', views: [globeView()], defaultView: 'globe' }));
      });
      const globe = container.querySelector<HTMLElement>('.wanderer-globe')!;
      for (let attempt = 0; attempt < 50 && globe.getAttribute('data-wanderer-globe-status') === 'loading'; attempt += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
      }
      const lisbon = [...container.querySelectorAll<HTMLButtonElement>('.wanderer-globe__location-button')]
        .find((button) => button.textContent?.includes('Lisbon'))!;
      await act(async () => { click(lisbon, dom.window); });
      await act(async () => { gl.frames.flush(); });
      const facing = projectMarker(38.72, -9.14, facingPhi(-9.14));
      const canvas = globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
      await act(async () => {
        canvas.dispatchEvent(new dom.window.PointerEvent('pointermove', {
          bubbles: true, cancelable: true, clientX: facing.x * 400, clientY: facing.y * 400, pointerId: 1, pointerType: 'mouse',
        }));
      });
      const tooltip = globe.querySelector('.wanderer-globe__tooltip');
      assert.ok(tooltip, 'hovering Lisbon shows a tooltip');
      assert.ok(tooltip.textContent?.includes('Lisbon'), 'the tooltip is for Lisbon');
      const values = [...tooltip.querySelectorAll('.wanderer-globe__tooltip-value')].map((node) => node.textContent);
      assert.deepEqual(values, ['2 talks', yearFormat('ar-EG').format(utc('2029-11-02'))]);
    } finally {
      await act(async () => { root.unmount(); });
      gl.cleanup();
      dom.cleanup();
    }
  });
});

describe('formatter reuse', () => {
  test('formatCalendarDate constructs one Intl.DateTimeFormat per locale and options', () => {
    const results: string[] = [];
    const constructions = countConstructions('DateTimeFormat', () => {
      for (let day = 1; day <= 28; day += 1) results.push(formatCalendarDate(`2030-03-${String(day).padStart(2, '0')}`, 'en-IE', { month: 'short', day: 'numeric' }));
      results.push(formatCalendarDate('2030-03-10', 'en-IE', { month: 'long' }));
    });
    assert.equal(constructions, 2);
    assert.equal(results[9], new Intl.DateTimeFormat('en-IE', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(utc('2030-03-10')));
    assert.equal(results[28], 'March', 'different options get their own formatter');
  });

  test('rendering many cards constructs a fixed number of formatters', () => {
    const talks = Array.from({ length: 40 }, (_, index) => talk({ id: `t${index}`, date: `20${10 + (index % 20)}-0${1 + (index % 9)}-1${index % 10}` }));
    const element = createElement(Talks, { talks, referenceDate: REFERENCE_DATE, locale: 'en-NZ' });
    const first = countConstructions('DateTimeFormat', () => { renderToString(element); });
    assert.ok(first <= 3, `month, full date and year formatters only (constructed ${first})`);
    assert.equal(countConstructions('DateTimeFormat', () => { renderToString(element); }), 0, 'a second render reuses them');
  });
});

describe('sorting cost', () => {
  test('sortTalks parses each date once instead of on every comparison', () => {
    const talks = Array.from({ length: 500 }, (_, index) => talk({ id: `t${index}`, date: `2030-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}` }));
    let sorted: ReturnType<typeof sortTalks> = [];
    assert.equal(countConstructions('Date', () => { sorted = sortTalks(talks); }), talks.length);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(sorted[index - 1].date >= sorted[index].date, 'still newest first');
    }
  });
});

describe('without a usable reference date nothing is upcoming', () => {
  const dated = [
    talk({ id: 'u2', date: '2031-09-01' }),
    talk({ id: 'p-2030', date: '2030-05-01' }),
    talk({ id: 'p-2028', date: '2028-01-01' }),
    talk({ id: 'nodate', date: '' }),
  ];

  test('groupTalks produces no upcoming group in separate or duplicate mode', () => {
    for (const upcoming of ['separate', 'duplicate'] as const) {
      for (const referenceDate of [undefined, '2031-02-30', 'tomorrow']) {
        const groups = groupTalks(dated, { referenceDate, upcoming });
        assert.deepEqual(groups.map((group) => group.id), ['year-2031', 'year-2030', 'year-2028', 'undated'], `${upcoming} ${referenceDate}`);
      }
    }
  });

  test('the component renders no Upcoming group, badge or upcoming marker', () => {
    for (const referenceDate of [undefined, '2031-02-30']) {
      const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate }));
      assert.equal(html.includes('data-wanderer-group="upcoming"'), false, String(referenceDate));
      assert.equal(html.includes('wanderer-badge--accent'), false);
      assert.equal(html.includes('data-wanderer-upcoming'), false);
      assert.ok(html.includes('data-wanderer-group="year-2031"'), 'future talks fall into their year');
    }
    const withReference = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE }));
    assert.ok(withReference.includes('data-wanderer-group="upcoming"'), 'control: a valid reference produces the group');
  });
});

describe('undated card margin', () => {
  const talks = [talk({ id: 'dated', date: '2030-01-01' }), talk({ id: 'nodate', date: '' })];
  const margins = (html: string) => [...html.matchAll(/wanderer-talk__when"[^>]*><span>([^<]*)</g)].map((match) => match[1]);

  test('defaults to an en dash and is replaceable through copy.undatedMonth', () => {
    assert.deepEqual(margins(renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE }))), ['Jan', '–']);
    const html = renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE, copy: { undated: 'TBA', undatedMonth: 'TBA' } }));
    assert.deepEqual(margins(html), ['Jan', 'TBA']);
    assert.equal(html.includes('–'), false);
  });
});

describe('hydration with different Intl data on the server', () => {
  const originalError = console.error;
  let consoleErrors: unknown[][];
  beforeEach(() => { consoleErrors = []; console.error = (...args: unknown[]) => { consoleErrors.push(args); }; });
  afterEach(() => { console.error = originalError; });

  test('a date the browser formats differently keeps the server text instead of regenerating the tree', async () => {
    const dom = installDom({ width: 1024 });
    const container = dom.document.getElementById('root')!;
    const element = () => createElement(Talks, {
      talks: [talk({ id: 'autumn', title: 'Autumn talk', date: '2030-09-10' })], referenceDate: REFERENCE_DATE, locale: 'en-GB',
    });
    container.innerHTML = renderToString(element());
    // Older ICU data abbreviates September in en-GB as "Sep" where current data prints "Sept".
    container.querySelector('time')!.textContent = '10 Sep 2030';
    container.querySelector('.wanderer-talk__when span')!.textContent = 'Sep';
    const serverRoot = container.querySelector('.wanderer');
    const errors: string[] = [];
    let root!: Root;
    await act(async () => { root = hydrateRoot(container, element(), { onRecoverableError: (error) => { errors.push(String(error)); } }); });
    try {
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      assert.equal(container.querySelector('.wanderer'), serverRoot, 'the server DOM was hydrated, not replaced');
      assert.equal(container.querySelector('time')?.textContent, '10 Sep 2030');
    } finally {
      await act(async () => { root.unmount(); });
      dom.cleanup();
    }
  });
});
