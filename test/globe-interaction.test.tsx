// Renderer behavior that needs a sized stage: resource release on unmount,
// the cobe marker cap, time-based rotation, device pixel ratio changes,
// multi-pointer drags and the hover tooltip.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement, StrictMode } from 'react';
import type { TalksProps } from '../src/component-types.js';
import { Talks } from '../src/index.js';
import { globeView } from '../src/globe.js';
import { deriveGeography } from '../src/helpers.js';
import { MAX_GLOBE_MARKERS } from '../src/globe/markers.js';
import { facingPhi, projectMarker } from '../src/globe/projection.js';
import { installDom, keydown, setInputValue, type DomHandle } from './support/dom.js';
import { mountGlobe } from './support/globe.js';
import { loadReactDomClient } from './support/react.js';
import { installFakeWebGl } from './support/webgl.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const STAGE = 400;

/** jsdom has no layout: give the renderer's scene a size so hover and sizing run. */
function sizeScene(dom: DomHandle, size = STAGE) {
  for (const name of ['clientWidth', 'clientHeight']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('wanderer-globe__scene') ? size : 0; },
    });
  }
}

function pointer(dom: DomHandle, canvas: HTMLCanvasElement, type: string, x: number, y = STAGE / 2, pointerId = 1, pointerType = 'mouse') {
  canvas.dispatchEvent(new dom.window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId, pointerType }));
}

/** The phi cobe last drew (cobe uploads phi as the `z` uniform). */
function drawnPhi(gl: { uniforms: Map<string, unknown> }): number {
  return gl.uniforms.get('z') as number;
}

/** cobe uploads the values onRender sets on the following frame, so a change shows up two frames later. */
async function settle(item: { frame(step?: number): Promise<void> }, step?: number) {
  await item.frame(step);
  await item.frame(step);
}

const still = { views: [globeView({ intro: false, autoRotate: false })] } satisfies Partial<TalksProps>;

describe('renderer resources', () => {
  test('unmounting removes the resize listener phenomenon adds and releases the WebGL context', async () => {
    let added = 0;
    let removed = 0;
    const item = await mountGlobe(cleanups, {}, {
      before: (dom) => {
        const add = dom.window.addEventListener.bind(dom.window);
        const remove = dom.window.removeEventListener.bind(dom.window);
        dom.window.addEventListener = ((type: string, ...rest: unknown[]) => { if (type === 'resize') added += 1; return (add as (...args: unknown[]) => void)(type, ...rest); }) as typeof add;
        dom.window.removeEventListener = ((type: string, ...rest: unknown[]) => { if (type === 'resize') removed += 1; return (remove as (...args: unknown[]) => void)(type, ...rest); }) as typeof remove;
      },
    });
    assert.equal(item.gl.programs, 1);
    assert.equal(added, 1, 'phenomenon registered its window resize listener');
    // Emptying the mapped set unmounts the renderer.
    await act(async () => { setInputValue(item.search, 'zzzz-nothing', item.dom.window); });
    assert.equal(removed, 1, 'the listener is removed with the globe');
    assert.equal(item.gl.rendererReleases, 1, 'the renderer context is released, not left for garbage collection');
    await act(async () => { setInputValue(item.search, '', item.dom.window); });
    await act(async () => { item.root.unmount(); });
    assert.equal(added, 2);
    assert.equal(removed, 2, 'nothing stays registered on window after unmount');
    assert.equal(item.gl.rendererReleases, 2);
  });

  test('StrictMode replaying the mount effect keeps the context the canvas still uses', async () => {
    const dom = installDom({ width: 1440, reducedMotion: true });
    const gl = installFakeWebGl(dom);
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => { await act(async () => { root.unmount(); }); gl.cleanup(); dom.cleanup(); });
    const talks = createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], defaultView: 'globe' });
    await act(async () => { root.render(createElement(StrictMode, null, talks)); });
    const globe = container.querySelector<HTMLElement>('.wanderer-globe')!;
    for (let attempt = 0; attempt < 50 && globe.getAttribute('data-wanderer-globe-status') === 'loading'; attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
    await act(async () => { gl.frames.flush(); });
    assert.equal(globe.getAttribute('data-wanderer-globe-status'), 'ready', 'the replayed effect built a working globe');
    assert.equal(gl.rendererReleases, 0, 'the context of a canvas still in the document is not released');
    await act(async () => { root.unmount(); });
    assert.equal(gl.rendererReleases, 1, 'a real unmount still releases it');
  });

  test('a restored context rebuilds the globe on it instead of releasing it', async () => {
    const item = await mountGlobe(cleanups);
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await act(async () => { canvas.dispatchEvent(new item.dom.window.Event('webglcontextlost', { cancelable: true })); });
    await act(async () => { canvas.dispatchEvent(new item.dom.window.Event('webglcontextrestored')); });
    assert.equal(item.gl.programs, 2);
    assert.equal(item.gl.rendererReleases, 0, 'the restored context is kept for the rebuilt globe');
  });
});

describe('the cobe marker cap', () => {
  const crowded = Array.from({ length: MAX_GLOBE_MARKERS + 6 }, (_, index) => talk({
    // Ids sort so the six extra, busier locations come last.
    id: `city-${String(index).padStart(3, '0')}`,
    location: `City ${index}, Country`,
    coordinates: [-60 + (index % 12) * 10, -170 + Math.floor(index / 12) * 50],
  }));
  const busy = Array.from({ length: 6 }, (_, index) => talk({
    id: `zz-busy-${index}`,
    location: `City ${MAX_GLOBE_MARKERS + index}, Country`,
    coordinates: crowded[MAX_GLOBE_MARKERS + index].coordinates,
  }));

  test('past 64 locations the busiest are drawn, and the hover only finds drawn markers', async () => {
    const talks = [...crowded, ...busy];
    const geography = deriveGeography(talks);
    assert.equal(geography.markers.length, MAX_GLOBE_MARKERS + 6);
    const item = await mountGlobe(cleanups, { talks, ...still }, { before: (dom) => sizeScene(dom) });
    await item.frame();
    assert.equal(item.gl.uniforms.get('C'), MAX_GLOBE_MARKERS * 2, 'cobe is given exactly 64 markers');
    assert.equal(item.section.querySelectorAll('.wanderer-globe__location').length, MAX_GLOBE_MARKERS + 6, 'the list keeps every location');
    // The lowest-count location that sorts first by id is one of the undrawn ones.
    const undrawn = geography.markers.find((marker) => marker.id === 'city-000')!;
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    const phi = drawnPhi(item.gl);
    const spot = projectMarker(undrawn.coordinates[0], undrawn.coordinates[1], phi);
    if (spot.visible) {
      await act(async () => { pointer(item.dom, canvas, 'pointermove', spot.x * STAGE, spot.y * STAGE); });
      assert.ok(!item.globe.querySelector('.wanderer-globe__tooltip')?.textContent?.includes('City 0,'), 'no tooltip over an undrawn location');
    }
  });
});

describe('motion', () => {
  test('idle rotation is time-based, so the refresh rate does not change the speed', async () => {
    // The same 960 ms rendered as 60 frames of 16 ms or 120 frames of 8 ms.
    const spin = async (step: number, frames: number) => {
      const item = await mountGlobe(cleanups, { views: [globeView({ intro: false })] }, { reducedMotion: false, before: (dom) => sizeScene(dom) });
      await settle(item, step);
      const start = drawnPhi(item.gl);
      for (let index = 0; index < frames; index += 1) await item.frame(step);
      return drawnPhi(item.gl) - start;
    };
    const at60 = await spin(16, 60);
    const at120 = await spin(8, 120);
    assert.ok(Math.abs(at60 - 0.00006 * 960) < 1e-9, `0.06 rad per second at 60 Hz, got ${at60}`);
    assert.ok(Math.abs(at120 - at60) < 1e-9, `120 Hz turns as fast as 60 Hz (${at120} vs ${at60})`);
  });

  test('a change of devicePixelRatio resizes the drawing buffer without rebuilding the globe', async () => {
    const item = await mountGlobe(cleanups, still, { before: (dom) => sizeScene(dom) });
    await item.frame();
    assert.deepEqual(item.gl.uniforms.get('w'), [STAGE, STAGE]);
    Object.defineProperty(item.dom.window, 'devicePixelRatio', { configurable: true, value: 2 });
    await item.frame();
    await item.frame();
    assert.deepEqual(item.gl.uniforms.get('w'), [STAGE * 2, STAGE * 2], 'browser zoom or a new display reaches the buffer');
    assert.equal(item.gl.programs, 1);
  });
});

describe('pointer input', () => {
  test('a second pointer neither resets nor ends the drag of the first', async () => {
    const item = await mountGlobe(cleanups, still, { before: (dom) => sizeScene(dom) });
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await settle(item);
    const start = drawnPhi(item.gl);
    await act(async () => {
      pointer(item.dom, canvas, 'pointerdown', 100, 200, 1, 'touch');
      pointer(item.dom, canvas, 'pointermove', 250, 200, 1, 'touch');
      pointer(item.dom, canvas, 'pointerdown', 300, 200, 2, 'touch');
    });
    await settle(item);
    assert.ok(Math.abs(drawnPhi(item.gl) - start - 0.75) < 1e-9, 'the second finger kept the first drag');
    await act(async () => { pointer(item.dom, canvas, 'pointerup', 300, 200, 2, 'touch'); });
    await act(async () => { pointer(item.dom, canvas, 'pointermove', 300, 200, 1, 'touch'); });
    await settle(item);
    assert.ok(Math.abs(drawnPhi(item.gl) - start - 1) < 1e-9, 'lifting the second finger did not end the first drag');
    await act(async () => { pointer(item.dom, canvas, 'pointerup', 300, 200, 1, 'touch'); });
    await settle(item);
    assert.ok(Math.abs(drawnPhi(item.gl) - start - 1) < 1e-9, 'the drag is committed when its own pointer lifts');
  });

  test('pointercancel ends the drag, keeps its rotation and lets auto-rotation resume', async () => {
    const item = await mountGlobe(cleanups, { views: [globeView({ intro: false })] }, { reducedMotion: false, before: (dom) => sizeScene(dom) });
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await item.frame();
    await act(async () => {
      pointer(item.dom, canvas, 'pointerdown', 100, 200, 1, 'touch');
      pointer(item.dom, canvas, 'pointermove', 300, 200, 1, 'touch');
    });
    await settle(item);
    const dragged = drawnPhi(item.gl);
    await settle(item);
    assert.equal(drawnPhi(item.gl), dragged, 'no idle spin while a drag is in progress');
    await act(async () => { pointer(item.dom, canvas, 'pointercancel', 300, 200, 1, 'touch'); });
    await settle(item);
    assert.ok(drawnPhi(item.gl) > dragged, 'auto-rotation resumes after the browser cancels the pointer, keeping the dragged rotation');
    assert.ok(drawnPhi(item.gl) - dragged < 0.01, 'the drag was committed, not dropped');
  });
});

describe('the hover tooltip', () => {
  async function hoverLisbon(props: Partial<TalksProps> = {}, before?: (dom: DomHandle) => void) {
    const item = await mountGlobe(cleanups, { ...still, ...props }, { before: (dom) => { sizeScene(dom); before?.(dom); } });
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    const lisbon = [...item.section.querySelectorAll<HTMLButtonElement>('.wanderer-globe__location-button')].find((button) => button.textContent?.includes('Lisbon'))!;
    await act(async () => { lisbon.click(); });
    await item.frame();
    const facing = projectMarker(38.72, -9.14, facingPhi(-9.14));
    const move = async (x = facing.x * STAGE, y = facing.y * STAGE) => { await act(async () => { pointer(item.dom, canvas, 'pointermove', x, y); }); };
    await move();
    return { item, canvas, move, tooltip: () => item.globe.querySelector<HTMLElement>('.wanderer-globe__tooltip') };
  }

  test('Escape dismisses the tooltip without switching views, and it stays dismissed until the pointer leaves the marker', async () => {
    const { item, move, tooltip } = await hoverLisbon();
    assert.ok(tooltip()?.textContent?.includes('Lisbon'));
    await act(async () => { keydown(item.globe.querySelector('.wanderer-globe__stage')!, 'Escape', item.dom.window); });
    assert.equal(tooltip(), null, 'Escape dismissed it');
    assert.equal(item.section.getAttribute('data-wanderer-view'), 'globe', 'the same Escape did not return to the list');
    await move();
    assert.equal(tooltip(), null, 'moving over the same marker does not bring it back');
    await move(5, 5);
    await move();
    assert.ok(tooltip()?.textContent?.includes('Lisbon'), 'leaving the marker and returning shows it again');
  });

  test('the tooltip is positioned by its rem width, so a 10px root font flips it later', async () => {
    const { item, tooltip } = await hoverLisbon({}, (dom) => { dom.document.documentElement.style.fontSize = '10px'; });
    const facing = projectMarker(38.72, -9.14, facingPhi(-9.14));
    const left = parseFloat(tooltip()!.style.left);
    const x = facing.x * STAGE;
    // A 160px tooltip fits after the marker (x + 16 + 160 <= 392) where a fixed 256px one would flip before it.
    assert.ok(x + 16 + 160 <= STAGE - 8 && x + 16 + 256 > STAGE - 8, 'the fixture sits where the two widths disagree');
    assert.equal(left, x + 16, 'placed after the marker');
    void item;
  });

  test('flips before the marker near the end edge and below it near the top', async () => {
    const item = await mountGlobe(cleanups, { talks: [talk({ id: 'east', location: 'East', coordinates: [60, 60] })], ...still }, { before: (dom) => sizeScene(dom) });
    await item.frame();
    const phi = drawnPhi(item.gl);
    const spot = projectMarker(60, 60, phi);
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await act(async () => { pointer(item.dom, canvas, 'pointermove', spot.x * STAGE, spot.y * STAGE); });
    const tooltip = item.globe.querySelector<HTMLElement>('.wanderer-globe__tooltip')!;
    assert.ok(tooltip, 'the busiest (only) location faces the viewer');
    const left = parseFloat(tooltip.style.left);
    assert.ok(left >= 8 && left + 256 <= STAGE - 8 + 1e-9, 'clamped inside the stage');
    assert.equal(tooltip.getAttribute('data-wanderer-tooltip-position'), spot.y * STAGE > STAGE * 0.4 ? 'above' : 'below');
  });
});
