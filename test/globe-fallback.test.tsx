import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Talks } from '../src/index.js';
import { GlobeRegionList, globeView, preloadGlobeView } from '../src/globe.js';
import type { TalksContext } from '../src/component-types.js';
import { deriveGeography } from '../src/helpers.js';
import { click, installDom, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';
import { spyOnRendererImport } from './support/import-hooks.js';

const { createRoot, hydrateRoot } = await loadReactDomClient();

const cleanups: (() => Promise<void>)[] = [];
// Run in reverse so roots unmount before their DOM globals disappear.
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function webglLessDom(width: number): DomHandle {
  const dom = installDom({ width });
  // jsdom has no canvas implementation; make the absence explicit and quiet.
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });
  return dom;
}

describe('GlobeView fallback without WebGL', () => {
  test('a globe-only configuration stays inline so fullscreen cannot trap the visitor', async () => {
    const dom = webglLessDom(1440);
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    await act(async () => { root.render(createElement(Talks, { talks: FIXTURE_TALKS, views: [globeView({ presentation: 'immersive' })], enabledViews: ['globe'] })); });
    assert.equal(container.querySelector('dialog'), null);
    assert.ok(container.querySelector('.wanderer-globe__locations'));
  });

  test('after hydration the globe view shows the unavailable copy with a working list button', async () => {
    const dom = webglLessDom(1440);
    const container = dom.document.getElementById('root')!;
    const changes: string[] = [];
    const element = () => createElement(Talks, {
      talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], defaultView: 'globe',
      copy: { globeUnavailable: 'Kein Globus', useList: 'Zur Liste' },
      onViewChange: (view, change) => changes.push(`${view}:${change.reason}`),
    });
    container.innerHTML = renderToString(element());
    assert.ok(container.querySelector('[data-wanderer-globe-status="idle"]'), 'server markup renders the idle globe shell');
    const errors: string[] = [];
    let root!: Root;
    await act(async () => { root = hydrateRoot(container, element(), { onRecoverableError: (error) => errors.push(String(error)) }); });
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    assert.deepEqual(errors, []);
    const section = container.querySelector('.wanderer')!;
    assert.equal(section.getAttribute('data-wanderer-view'), 'globe');
    const globe = section.querySelector('.wanderer-globe')!;
    assert.equal(globe.getAttribute('data-wanderer-globe-status'), 'error');
    assert.equal(globe.getAttribute('data-wanderer-globe-error'), 'webgl');
    assert.equal(globe.querySelector('.wanderer-empty__title')?.textContent, 'Kein Globus');
    assert.ok(globe.querySelector('.wanderer-globe__lists'), 'the accessible location list still renders');
    assert.equal(globe.querySelector('.wanderer-globe__summary')?.textContent, '4 talks in 3 locations');
    const useList = [...globe.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Zur Liste')!;
    assert.ok(useList);
    await act(async () => { click(useList, dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
    assert.ok(section.querySelector('.wanderer-list'));
    assert.deepEqual(changes, ['globe:initial', 'list:user']);
    assert.equal(dom.document.activeElement?.id, section.querySelector('.wanderer-view__heading')?.id);
  });

  test('the immersive presentation adds a back-to-list control that also works', async () => {
    const dom = webglLessDom(1440);
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    await act(async () => {
      root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView({ presentation: 'immersive' })], defaultView: 'globe' }));
    });
    const section = container.querySelector('.wanderer')!;
    assert.ok(section.querySelector('.wanderer-globe--immersive'));
    const back = section.querySelector<HTMLButtonElement>('.wanderer-shell__close')!;
    assert.equal(back.textContent, 'Exit fullscreen');
    assert.ok(back.closest('dialog')?.querySelector('input[type=search]'), 'the search stays inside fullscreen');
    await act(async () => { click(back, dom.window); });
    assert.equal(section.getAttribute('data-wanderer-view'), 'list');
  });

  test('preloadGlobeView in a browser-like environment shares one renderer import', async () => {
    const dom = webglLessDom(1440);
    const spy = spyOnRendererImport();
    cleanups.push(async () => { spy.restore(); dom.cleanup(); });
    const first = preloadGlobeView();
    assert.ok(first instanceof Promise);
    // The renderer module imports cobe, which needs a real WebGL canvas only when mounted; loading is fine here.
    await Promise.all([first, preloadGlobeView()]);
    await preloadGlobeView();
    assert.ok(spy.imports <= 1, `every call shares the memoized import (saw ${spy.imports})`);
  });
});

describe('GlobeRegionList', () => {
  test('renders regions and locations, expands a location to list its talks with links', async () => {
    const dom = installDom({ width: 1440 });
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); dom.cleanup(); });
    let captured: TalksContext | null = null;
    function Capture() {
      return createElement(ContextGrabber, null);
    }
    const { useTalks } = await import('../src/index.js');
    function ContextGrabber() { captured = useTalks(); return null; }
    await act(async () => {
      root.render(createElement(Talks, {
        talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE,
        views: [{ id: 'capture', label: 'Capture', Component: Capture }], defaultView: 'capture',
        geography: { assignRegion: (_talk, [, lng]) => (lng < 0 ? 'West' : 'East') },
      }));
    });
    assert.ok(captured);
    const context = captured as TalksContext;
    const geography = deriveGeography(context.talks, context.geographyOptions);
    const listRoot = dom.document.createElement('div');
    dom.document.body.appendChild(listRoot);
    const listReactRoot = createRoot(listRoot);
    cleanups.push(async () => { await act(async () => { listReactRoot.unmount(); }); });
    await act(async () => { listReactRoot.render(createElement(GlobeRegionList, { context, geography })); });

    const regions = [...listRoot.querySelectorAll('.wanderer-globe__region')].map((node) => node.textContent);
    assert.deepEqual(regions, ['West100.0%']);
    const locations = [...listRoot.querySelectorAll('.wanderer-globe__location-name')].map((node) => node.textContent);
    assert.deepEqual(locations, ['Lisbon, Portugal', 'Reykjavik, Iceland', 'Marrakesh, Morocco'], 'sorted by count then id');
    const values = [...listRoot.querySelectorAll('.wanderer-globe__location-value')].map((node) => node.textContent);
    assert.deepEqual(values, ['50.0%', '25.0%', '25.0%']);

    const buttons = [...listRoot.querySelectorAll<HTMLButtonElement>('.wanderer-globe__location-button')];
    const panels = [...listRoot.querySelectorAll<HTMLElement>('.wanderer-globe__location-panel')];
    assert.ok(panels.every((panel) => panel.hidden), 'all panels start collapsed');
    assert.ok(buttons.every((button) => button.getAttribute('aria-expanded') === 'false'));
    await act(async () => { click(buttons[0], dom.window); });
    assert.equal(buttons[0].getAttribute('aria-expanded'), 'true');
    assert.equal(panels[0].hidden, false);
    assert.equal(buttons[0].getAttribute('aria-controls'), panels[0].id);
    assert.ok(panels[0].querySelector('.wanderer-globe__location-summary')?.textContent?.includes('2 talks'));
    assert.ok(panels[0].querySelector('.wanderer-globe__location-summary')?.textContent?.includes('Latest: 2029'));
    const talkLinks = [...panels[0].querySelectorAll<HTMLAnchorElement>('a')];
    assert.deepEqual(talkLinks.map((link) => [link.textContent, link.getAttribute('href')]), [
      ['Beacon Observability Patterns', '/talks/beacon-2029'],
      ['Ember Networking Deep Dive', 'https://harbor.example/2029'],
    ]);
    await act(async () => { click(buttons[1], dom.window); });
    assert.equal(panels[0].hidden, true, 'only one location is expanded at a time');
    assert.equal(panels[1].hidden, false);
    await act(async () => { click(buttons[1], dom.window); });
    assert.equal(panels[1].hidden, true, 'clicking again collapses');
  });

  test('with no mapped talks it renders the noMappedTalks copy and no regions section', async () => {
    const html = renderToString(createElement(Talks, {
      talks: FIXTURE_TALKS.map((talk) => ({ ...talk, format: 'online' as const })), referenceDate: REFERENCE_DATE,
      views: [globeView()], defaultView: 'globe', copy: { noMappedTalks: 'Nothing mapped' },
    }));
    assert.ok(html.includes('Nothing mapped'));
    assert.equal(html.includes('wanderer-globe__regions'), false);
    assert.ok(html.includes('0 talks in 0 locations'));
  });
});
