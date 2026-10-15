import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Talks } from '../src/index.js';
import { GlobeRegionList, GlobeView, globeView } from '../src/globe.js';
import type { LinkComponentProps, Milestone, TalkViewProps } from '../src/component-types.js';
import { click, setInputValue, type DomHandle } from './support/dom.js';
import { mountGlobe } from './support/globe.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const LISBON: Milestone = { id: 'lisbon', title: 'Lisbon milestone', coordinates: [38.72, -9.14] };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function status(globe: Element | null): string {
  return `${globe?.getAttribute('data-wanderer-globe-status')}/${globe?.getAttribute('data-wanderer-globe-error')}`;
}

function locationButton(root: Element, label: string): HTMLButtonElement {
  return [...root.querySelectorAll<HTMLButtonElement>('.wanderer-globe__location-button')].find((button) => button.textContent?.includes(label))!;
}

function lose(canvas: HTMLCanvasElement, dom: DomHandle): void {
  canvas.dispatchEvent(new dom.window.Event('webglcontextlost', { cancelable: true }));
}

describe('globeView() component identity', () => {
  test('the same options give the same component; label, heading and order do not matter', () => {
    assert.equal(globeView().Component, globeView({}).Component);
    assert.equal(globeView({ intro: false, label: 'Map' }).Component, globeView({ intro: false, heading: 'Map', order: 3 }).Component);
    assert.notEqual(globeView().Component, globeView({ intro: false }).Component);
    assert.notEqual(globeView().Component, globeView({ presentation: 'immersive' }).Component);
  });

  test('an inline views={[globeView()]} keeps the mounted globe and its state across parent renders', async () => {
    const item = await mountGlobe(cleanups, { views: [globeView()] });
    const canvas = item.section.querySelector('.wanderer-globe__canvas');
    assert.ok(canvas);
    await act(async () => { click(locationButton(item.section, 'Lisbon'), item.dom.window); });
    for (const theme of ['dark', 'light', 'dark'] as const) await item.rerender({ views: [globeView()], theme });
    assert.equal(item.gl.programs, 1, 'no new globe per parent render');
    assert.equal(item.gl.released, 1, 'no new WebGL probe per parent render');
    assert.equal(item.section.querySelector('.wanderer-globe__canvas'), canvas, 'the same canvas stays mounted');
    assert.equal(locationButton(item.section, 'Lisbon').getAttribute('aria-expanded'), 'true', 'view state survives');
  });
});

describe('GlobeView context loss', () => {
  test('a context lost while the page is hidden gets the full grace period once the page is visible again', async () => {
    const item = await mountGlobe(cleanups);
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await act(async () => { item.gl.setVisible(false); });
    await act(async () => { lose(canvas, item.dom); });
    await item.wait(2100);
    assert.equal(status(item.globe), 'ready/null', 'no fallback while hidden');
    assert.ok(canvas.isConnected, 'the canvas stays mounted to receive the restore');
    await act(async () => { item.gl.setVisible(true); });
    await item.wait(1000);
    assert.equal(status(item.globe), 'ready/null', 'the grace period starts over when the page is shown');
    await item.wait(1100);
    assert.equal(status(item.globe), 'error/runtime', 'a context that never comes back still falls back');
  });

  test('a pending grace period does not tear down a globe rebuilt after the markers emptied and refilled', async () => {
    const item = await mountGlobe(cleanups);
    await act(async () => { lose(item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!, item.dom); });
    await act(async () => { setInputValue(item.search, 'zzzz-nothing', item.dom.window); });
    await act(async () => { setInputValue(item.search, '', item.dom.window); });
    assert.equal(item.gl.programs, 2, 'a fresh globe on a fresh canvas');
    await item.wait(2100);
    assert.equal(status(item.globe), 'ready/null');
    assert.ok(item.globe.querySelector('.wanderer-globe__canvas'), 'the rebuilt globe stays');
  });
});

describe('GlobeView milestones and controls', () => {
  test('milestones whose coordinates are not a finite latitude and longitude in range are dropped', async () => {
    const item = await mountGlobe(cleanups, {
      milestones: [
        LISBON,
        { id: 'blank', title: 'Blank field', coordinates: [Number.NaN, Number.NaN] },
        { id: 'typo', title: 'Typo', coordinates: [999, 999] },
        { id: 'empty', title: 'Empty pair', coordinates: [] as unknown as [number, number] },
        { id: 'via-talk', title: 'Via talk', talkId: 'aurora-2030' },
      ],
    });
    const options = [...item.globe.querySelectorAll<HTMLOptionElement>('.wanderer-globe__milestones option')].map((option) => option.value);
    assert.deepEqual(options, ['', 'lisbon', 'via-talk']);
  });

  test('keyboard focus holds an automatic milestone card open, and Dismiss moves focus to the milestone select', async () => {
    const item = await mountGlobe(cleanups, { milestones: [LISBON], views: [globeView({ intro: false })] }, { reducedMotion: false });
    // Lisbon is the busiest location, so it faces the viewer and the queue shows its card.
    await item.frame(3000);
    const callout = item.globe.querySelector('.wanderer-globe__callout');
    assert.ok(callout, 'the automatic card is shown');
    const dismiss = callout.querySelector<HTMLButtonElement>('.wanderer-globe__dismiss')!;
    await act(async () => { dismiss.focus(); });
    for (let frame = 0; frame < 3; frame += 1) await item.frame(10_000);
    assert.ok(item.globe.querySelector('.wanderer-globe__callout'), 'the card does not time out under keyboard focus');
    assert.equal(item.dom.document.activeElement, dismiss);
    assert.ok([...item.globe.querySelectorAll('button')].some((button) => button.textContent === 'Resume animation'), 'focusing the card paused automatic motion');
    await act(async () => { click(dismiss, item.dom.window); });
    assert.equal(item.globe.querySelector('.wanderer-globe__callout'), null);
    assert.equal(item.dom.document.activeElement, item.globe.querySelector('.wanderer-globe__milestones select'), 'focus stays in the globe controls');
  });

  test('the drag hint is shown only while the globe can be drawn', async () => {
    const ready = await mountGlobe(cleanups);
    assert.ok(ready.globe.querySelector('.wanderer-globe__hint'), 'shown with the globe');
    await act(async () => { setInputValue(ready.search, 'zzzz-nothing', ready.dom.window); });
    assert.ok(ready.stage.querySelector('.wanderer-empty'));
    assert.equal(ready.globe.querySelector('.wanderer-globe__hint'), null, 'not under the no-mapped-talks state');
    const noWebGl = await mountGlobe(cleanups, {}, { deny: () => true });
    assert.equal(status(noWebGl.globe), 'error/webgl');
    assert.equal(noWebGl.globe.querySelector('.wanderer-globe__hint'), null, 'not under the unavailable fallback');
    const html = renderToString(createElement(Talks, {
      talks: FIXTURE_TALKS.map((talk) => ({ ...talk, format: 'online' as const })), referenceDate: REFERENCE_DATE, views: [globeView()], defaultView: 'globe',
    }));
    assert.equal(html.includes('wanderer-globe__hint'), false, 'not in server markup without mapped talks');
  });

  test('the location panel is named apart from the interactive globe', async () => {
    const item = await mountGlobe(cleanups);
    const panelName = () => {
      const panel = item.globe.querySelector('aside.wanderer-globe__panel')!;
      return item.dom.document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent;
    };
    assert.equal(panelName(), 'Talk locations');
    assert.equal(item.stage.getAttribute('aria-label'), 'Interactive globe of talk locations');
    await item.rerender({ copy: { globePanelLabel: 'Vortragsorte' } });
    assert.equal(panelName(), 'Vortragsorte');
  });

  test('a milestone change does not re-render the location list', async () => {
    let linkRenders = 0;
    function CountingLink(props: LinkComponentProps) {
      linkRenders += 1;
      return createElement('a', props);
    }
    const item = await mountGlobe(cleanups, { milestones: [LISBON], navigation: { LinkComponent: CountingLink } });
    // The Lisbon panel lists a talk with a detail link, which LinkComponent renders.
    await act(async () => { click(locationButton(item.section, 'Lisbon'), item.dom.window); });
    const initial = linkRenders;
    assert.ok(initial > 0, 'the detail link in the open location panel renders through LinkComponent');
    const select = item.globe.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = 'lisbon'; select.dispatchEvent(new item.dom.window.Event('change', { bubbles: true })); });
    assert.ok(item.globe.querySelector('.wanderer-globe__callout'));
    assert.equal(linkRenders, initial);
  });

  test('only the open location panel holds its talks', async () => {
    const item = await mountGlobe(cleanups);
    const panels = () => [...item.globe.querySelectorAll('.wanderer-globe__location-panel')];
    assert.ok(panels().length > 1);
    assert.ok(panels().every((panel) => panel.hasAttribute('hidden') && panel.childElementCount === 0), 'closed panels are empty');
    await act(async () => { click(locationButton(item.section, 'Lisbon'), item.dom.window); });
    const open = panels().filter((panel) => !panel.hasAttribute('hidden'));
    assert.equal(open.length, 1);
    assert.ok(open[0].querySelectorAll('.wanderer-globe__location-talks li').length >= 1);
    assert.equal(locationButton(item.section, 'Lisbon').getAttribute('aria-controls'), open[0].id);
  });

  test('a milestone picked in the select is announced and controlled by the select; the placeholder does not pause', async () => {
    const item = await mountGlobe(cleanups, { milestones: [LISBON], views: [globeView({ intro: false })] }, { reducedMotion: false });
    const select = item.globe.querySelector<HTMLSelectElement>('.wanderer-globe__milestones select')!;
    const live = () => item.globe.querySelector('[data-wanderer-announcement="milestone"]')!.textContent;
    const pauseLabel = () => [...item.globe.querySelectorAll('.wanderer-globe__controls button')].map((button) => button.textContent).find((text) => /animation/.test(text ?? ''));
    await act(async () => { select.value = ''; select.dispatchEvent(new item.dom.window.Event('change', { bubbles: true })); });
    assert.equal(pauseLabel(), 'Pause animation', 'choosing the placeholder keeps automatic motion');
    await act(async () => { select.value = 'lisbon'; select.dispatchEvent(new item.dom.window.Event('change', { bubbles: true })); });
    assert.equal(live(), 'Milestone: Lisbon milestone');
    const callout = item.globe.querySelector('.wanderer-globe__callout')!;
    assert.equal(select.getAttribute('aria-controls'), callout.id);
    assert.equal(pauseLabel(), 'Resume animation');
  });

  test('search keystrokes do not resubscribe to visibilitychange', async () => {
    let subscriptions = 0;
    const item = await mountGlobe(cleanups, {}, {
      before: (dom) => {
        const add = dom.document.addEventListener.bind(dom.document);
        dom.document.addEventListener = ((type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]) => {
          if (type === 'visibilitychange') subscriptions += 1;
          add(type, ...rest);
        }) as typeof dom.document.addEventListener;
      },
    });
    const initial = subscriptions;
    for (const query of ['e', 'er', 'e', '']) {
      await act(async () => { setInputValue(item.search, query, item.dom.window); });
    }
    assert.equal(subscriptions, initial);
  });
});

describe('GlobeView as a public component', () => {
  test('works directly as a view component without options', async () => {
    const views = [{ id: 'globe', label: 'Globe', Component: GlobeView }];
    const html = renderToString(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views, defaultView: 'globe' }));
    assert.ok(html.includes('wanderer-globe--inline'), 'server rendering does not throw');
    const item = await mountGlobe(cleanups, { views });
    assert.equal(status(item.globe), 'ready/null');
    assert.equal(item.section.querySelector('.wanderer-error'), null);
  });

  test('globeView label, heading and order reach the toolbar and the view heading', async () => {
    const item = await mountGlobe(cleanups, { views: [globeView({ label: 'Map', heading: 'Where I spoke', order: -1 })] });
    const buttons = [...item.section.querySelectorAll('.wanderer-views__button')].map((button) => button.textContent);
    assert.deepEqual(buttons, ['Map', 'List'], 'order -1 sorts before the list');
    assert.equal(item.section.querySelector('.wanderer-view__heading')?.textContent, 'Where I spoke');
  });

  test('GlobeRegionList follows a controlled expanded id and reports toggles', async () => {
    const toggles: (string | null)[] = [];
    function Controlled({ context }: TalkViewProps) {
      const lisbon = context.geography.markers.find((marker) => marker.label.startsWith('Lisbon'))!;
      return createElement(GlobeRegionList, { context, geography: context.geography, expanded: lisbon.id, onToggle: (id) => toggles.push(id) });
    }
    const item = await mountGlobe(cleanups, { views: [{ id: 'controlled', label: 'Controlled', Component: Controlled }], defaultView: 'controlled' });
    const lisbon = locationButton(item.section, 'Lisbon');
    const reykjavik = locationButton(item.section, 'Reykjavik');
    assert.equal(lisbon.getAttribute('aria-expanded'), 'true');
    await act(async () => { click(lisbon, item.dom.window); });
    await act(async () => { click(reykjavik, item.dom.window); });
    assert.equal(toggles.length, 2);
    assert.equal(toggles[0], null, 'collapsing the expanded location reports null');
    assert.notEqual(toggles[1], null);
    assert.equal(lisbon.getAttribute('aria-expanded'), 'true', 'the controlled value wins over clicks');
    assert.equal(reykjavik.getAttribute('aria-expanded'), 'false');
  });

  test('under RTL the connector anchor mirrors to the inline-start side of the stage', async () => {
    const item = await mountGlobe(cleanups, { milestones: [LISBON], direction: 'rtl' }, {
      before: (dom) => {
        // A 500px stage at the inline end of a 900px column leaves 400px on its inline-start side.
        Object.defineProperty(dom.window.Element.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: function getBoundingClientRect(this: Element) {
            if (this.classList.contains('wanderer-globe__stage')) return { left: 400, right: 900, top: 0, bottom: 500, width: 500, height: 500, x: 400, y: 0, toJSON() {} };
            if (this.classList.contains('wanderer-globe__stage-wrap')) return { left: 0, right: 900, top: 0, bottom: 500, width: 900, height: 500, x: 0, y: 0, toJSON() {} };
            return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
          },
        });
      },
    });
    assert.equal(item.stage.getAttribute('data-wanderer-callout'), 'beside');
    const line = item.globe.querySelector('.wanderer-globe__connector')!;
    assert.equal(line.getAttribute('x2'), '-4%', '104% mirrored');
    assert.equal(line.getAttribute('y2'), '42%');
  });

  test('the tokens prop reaches the WebGL colors', async () => {
    const uploads: number[][] = [];
    const item = await mountGlobe(cleanups, { tokens: { '--wanderer-globe-land': '#ff0000', '--wanderer-globe-marker': 'rgb(0 0 255)' } }, {
      before: (dom) => {
        const prototype = dom.window.HTMLCanvasElement.prototype;
        const fake = prototype.getContext as (this: HTMLCanvasElement, type: string) => object | null;
        Object.defineProperty(prototype, 'getContext', {
          configurable: true,
          writable: true,
          value: function getContext(this: HTMLCanvasElement, type: string) {
            const gl = fake.call(this, type);
            if (!gl) return gl;
            return new Proxy(gl, {
              get(target, property, receiver) {
                if (property === 'uniform3fv') return (_location: unknown, value: ArrayLike<number>) => { uploads.push([...Array.from(value)]); };
                return Reflect.get(target, property, receiver);
              },
            });
          },
        });
      },
    });
    await item.frame();
    await item.frame();
    const uploaded = (rgb: number[]) => uploads.some((value) => value.length === 3 && value.every((channel, index) => Math.abs(channel - rgb[index]) < 1e-6));
    assert.ok(uploaded([1, 0, 0]), 'the land token is uploaded');
    assert.ok(uploaded([0, 0, 1]), 'the marker token is uploaded');
  });
});
