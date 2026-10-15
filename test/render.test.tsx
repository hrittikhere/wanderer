import { afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Talks } from '../src/index.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface SsrObservations {
  renderAccesses: string[];
  accesses: string[];
  resolved: string[];
  preloadIsPromise: boolean;
  preloadSettled: boolean;
  responsive: { length: number; smallShells: number; largeShells: number; activeShells: number; hasBreakpoint: boolean; viewSmall?: string; viewLarge?: string; globeStatus?: string };
  fixedList: { smallShells: number; largeShells: number; activeShells: number; view?: string };
  fixedGlobe: { activeShells: number; view?: string; globeStatus?: string };
}

describe('server rendering without browser globals', () => {
  let observed: SsrObservations;

  before(() => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, 'support', 'ssr-child.ts')], {
      encoding: 'utf8',
      cwd: path.resolve(here, '..'),
    });
    assert.equal(result.status, 0, `SSR child failed: ${result.stderr}`);
    observed = JSON.parse(result.stdout) as SsrObservations;
  });

  test('importing and rendering never touches window or document', () => {
    assert.deepEqual(observed.renderAccesses, []);
  });

  test('responsive mode renders both shells; a fixed defaultView renders exactly one', () => {
    assert.equal(observed.responsive.smallShells, 1);
    assert.equal(observed.responsive.largeShells, 1);
    assert.equal(observed.responsive.activeShells, 0);
    assert.equal(observed.responsive.hasBreakpoint, true);
    assert.equal(observed.responsive.viewSmall, 'list');
    assert.equal(observed.responsive.viewLarge, 'globe');
    assert.equal(observed.responsive.globeStatus, 'idle', 'the globe renders its idle shell on the server');
    assert.deepEqual([observed.fixedList.smallShells, observed.fixedList.largeShells, observed.fixedList.activeShells], [0, 0, 1]);
    assert.equal(observed.fixedList.view, 'list');
    assert.equal(observed.fixedGlobe.activeShells, 1);
    assert.equal(observed.fixedGlobe.view, 'globe');
  });

  test('preloadGlobeView resolves on the server and only its SSR guard reads window', () => {
    assert.equal(observed.preloadIsPromise, true);
    assert.equal(observed.preloadSettled, true);
    assert.deepEqual(observed.accesses, ['window']);
  });

  test('neither the globe entry nor preloadGlobeView loads the renderer or cobe on the server', () => {
    assert.ok(observed.resolved.some((url) => url.endsWith('/src/globe/GlobeView.tsx')), 'the trace saw the globe entry');
    const forbidden = observed.resolved.filter((url) => /\/globe\/renderer\.|[\\/]cobe[\\/]/.test(url));
    assert.deepEqual(forbidden, []);
  });
});

describe('renderToString markup', () => {
  const originalError = console.error;
  let errors: unknown[][];
  beforeEach(() => { errors = []; console.error = (...args: unknown[]) => { errors.push(args); }; });
  afterEach(() => { console.error = originalError; });

  test('renders a non-English configuration: custom copy, de-DE dates, rtl direction, custom heading level', () => {
    const talks = [
      talk({ id: 'nord-1', title: 'Nordlicht Netzwerke', event: 'Fjordkonferenz', date: '2030-03-10', description: 'Ein fiktiver Vortrag.', location: 'Bergen, Norwegen', format: 'in-person', eventUrl: 'https://fjord.example', recordingUrl: 'https://videos.example/nord' }),
      talk({ id: 'nord-2', title: 'Polarkreis Pipelines', event: 'Online Treffen', date: '2031-12-01', description: 'Noch ein fiktiver Vortrag.', format: 'online' }),
    ];
    const html = renderToString(createElement(Talks, {
      talks,
      referenceDate: REFERENCE_DATE,
      locale: 'de-DE',
      dateFormat: { year: 'numeric', month: 'long', day: 'numeric' },
      direction: 'rtl',
      headingLevel: 3,
      theme: 'dark',
      density: 'compact',
      copy: {
        rootLabel: 'Vorträge', listHeading: 'Alle Vorträge', upcoming: 'Demnächst', upcomingBadge: 'Bald', searchPlaceholder: 'Suchen',
        recordingFilter: 'Mit Aufzeichnung', upcomingFilter: 'Nur kommende', recordingAction: 'Aufzeichnung ansehen',
        resultCount: (count, total) => `${count} von ${total}`,
        groupCount: (count) => `${count} Vorträge`,
      },
    }));
    assert.ok(html.includes('10. März 2030'), 'German month name in the date');
    assert.ok(html.includes('1. Dezember 2031'));
    assert.ok(html.includes('dir="rtl"'));
    assert.ok(html.includes('aria-label="Vorträge"'));
    assert.ok(html.includes('data-wanderer-theme="dark"'));
    assert.ok(html.includes('data-wanderer-density="compact"'));
    assert.ok(html.includes('<h3') && html.includes('Alle Vorträge'), 'heading level applies to the view heading');
    assert.ok(html.includes('<h4') && html.includes('Demnächst'), 'group headings use the next level');
    assert.ok(html.includes('<h5'), 'talk titles use the level after that');
    assert.ok(html.includes('>Bald<'), 'upcoming badge copy');
    assert.ok(html.includes('2 von 2'));
    assert.ok(html.includes('Mit Aufzeichnung') && html.includes('Nur kommende'));
    assert.ok(html.includes('placeholder="Suchen"'));
    assert.ok(html.includes('Aufzeichnung ansehen: Nordlicht Netzwerke'), 'action label through actionLabel');
    assert.ok(/<a(?=[^>]*href="https:\/\/fjord\.example")[^>]*class="wanderer-talk__title-link"/.test(html), 'the event link is the title link');
    assert.equal(html.includes('Ein fiktiver Vortrag.'), false, 'compact density hides descriptions');
    assert.deepEqual(errors, []);
  });

  test('an empty dataset renders the noTalks copy', () => {
    const html = renderToString(createElement(Talks, { talks: [], referenceDate: REFERENCE_DATE, copy: { noTalks: 'Nothing scheduled', noTalksDescription: 'Check back soon.' } }));
    assert.ok(html.includes('Nothing scheduled'));
    assert.ok(html.includes('Check back soon.'));
    assert.ok(html.includes('role="status"'));
    assert.equal(html.includes('wanderer-talk"'), false);
    assert.deepEqual(errors, []);
  });

  test('a search with no match renders the noMatches copy and a reset button', () => {
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, defaultSearch: 'zzz-no-such-talk', copy: { noMatches: 'Nichts gefunden', resetAll: 'Zurücksetzen' } }));
    assert.ok(html.includes('Nichts gefunden'));
    assert.ok(html.includes('<button type="button" class="wanderer-button">Zurücksetzen</button>'));
    assert.ok(html.includes('0 of 5 talks'));
    assert.deepEqual(errors, []);
  });

  test('undated talks render under a configurable Undated group with no <time> element', () => {
    const talks = [talk({ id: 'dated', date: '2030-01-01' }), talk({ id: 'nodate', date: '' })];
    const html = renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE, copy: { undated: 'Date to be announced' } }));
    assert.ok(html.includes('data-wanderer-group="undated"'));
    assert.ok(html.includes('data-wanderer-group="year-2030"'));
    assert.ok((html.match(/Date to be announced/g) ?? []).length >= 2, 'group label and the talk meta use the undated copy');
    assert.equal((html.match(/<time /g) ?? []).length, 1);
    assert.deepEqual(errors, []);
  });

  test('duplicate ids never produce React key warnings and only the first entry renders', () => {
    const talks = [talk({ id: 'same', title: 'First' }), talk({ id: 'same', title: 'Second' }), talk({ id: 'same', title: 'Third' })];
    const validations: unknown[] = [];
    const html = renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE, onValidation: (result) => validations.push(result) }));
    assert.ok(html.includes('First'));
    assert.equal(html.includes('Second'), false);
    assert.equal(html.includes('Third'), false);
    assert.deepEqual(errors, [], 'no console.error (would include key warnings)');
  });

  test('duplicate or reserved link ids never produce duplicate action keys', () => {
    const talks = [talk({
      id: 'links', eventUrl: 'https://event.example',
      links: [
        { kind: 'general', url: 'https://a.example', id: 'notes', label: 'Notes A' },
        { kind: 'general', url: 'https://b.example', id: 'notes', label: 'Notes B' },
        { kind: 'general', url: 'https://c.example', id: 'general-0', label: 'Notes C' },
        { kind: 'general', url: 'https://d.example', id: 'event', label: 'Notes D' },
      ],
    })];
    const html = renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE }));
    for (const label of ['Notes A', 'Notes B', 'Notes C', 'Notes D']) assert.ok(html.includes(label), `${label} renders`);
    assert.deepEqual(errors, [], 'no console.error (would include duplicate key warnings)');
  });

  test('blank link labels fall back to the default action text and accessible name', () => {
    const talks = [talk({
      id: 'blank', title: 'Blank labels', eventUrl: 'https://event.example',
      links: [{ kind: 'general', url: 'https://a.example', label: '' }, { kind: 'slides', url: 'https://b.example', label: '   ' }],
    })];
    const html = renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE }));
    assert.ok(/aria-label="Link: Blank labels"[^>]*href="https:\/\/a\.example"[^>]*>.*?<span>Link<\/span>/.test(html), 'general action keeps its text');
    assert.ok(/aria-label="Slides: Blank labels"[^>]*href="https:\/\/b\.example"[^>]*>.*?<span>Slides<\/span>/.test(html), 'slides action keeps its text');
    assert.equal(/aria-label="\s*:/.test(html), false, 'no action is named only by the talk title');
    assert.deepEqual(errors, []);
  });

  test('strict validation with errors renders the validationError alert instead of talks', () => {
    const html = renderToString(createElement(Talks, { talks: [talk({ id: 'ok' }), talk({ id: 'bad', date: 'nope' })], referenceDate: REFERENCE_DATE, validation: 'strict' }));
    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes('The talks could not be displayed because the data is invalid.'));
    assert.equal(html.includes('wanderer-talk"'), false);
    assert.deepEqual(errors, []);
  });

  test('talk links come out with the right target and rel, and unsafe links are dropped', () => {
    const talks = [talk({ id: 'links', detailUrl: '/talks/links', recordingUrl: 'https://rec.example/x', eventUrl: 'javascript:alert(1)' })];
    const html = renderToString(createElement(Talks, { talks, referenceDate: REFERENCE_DATE }));
    assert.ok(html.includes('href="/talks/links"'));
    assert.ok(/<a[^>]*href="https:\/\/rec\.example\/x"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(html));
    assert.equal(html.includes('javascript:'), false);
    assert.deepEqual(errors, []);
  });

  test('tokens become inline custom properties and className is appended', () => {
    const html = renderToString(createElement(Talks, { talks: [], referenceDate: REFERENCE_DATE, className: 'site-talks', tokens: { '--wanderer-accent': '#ff6600' } }));
    assert.ok(html.includes('class="wanderer site-talks"'));
    assert.ok(html.includes('--wanderer-accent:#ff6600'));
  });
});
