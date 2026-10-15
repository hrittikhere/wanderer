// The particle intro: its frame loop, its pure scene and drawing functions,
// and how the renderer hands rotation over to the globe. The fake harness
// answers getContext('2d') with a recording context here, so the sketch
// actually runs instead of bailing out to the finished state.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act } from 'react';
import { globeView } from '../src/globe.js';
import { FrameLoop } from '../src/globe/frame-loop.js';
import {
  INTRO_DURATION_MS, INTRO_REVEAL_DELAY_MS, INTRO_REVEAL_DURATION_MS, buildIntroClusters, buildIntroDots, drawIntroFrame,
} from '../src/globe/intro.js';
import { facingPhi } from '../src/globe/projection.js';
import { parseCssTime } from '../src/globe/renderer.js';
import { deriveGeography } from '../src/helpers.js';
import type { GlobeMarker } from '../src/types.js';
import type { DomHandle } from './support/dom.js';
import { mountGlobe, type MountedGlobe } from './support/globe.js';
import { FIXTURE_TALKS, talk } from './support/fixtures.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function sizeScene(dom: DomHandle, size = 400) {
  for (const name of ['clientWidth', 'clientHeight']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('wanderer-globe__scene') ? size : 0; },
    });
  }
}

const busiest = (): GlobeMarker => deriveGeography(FIXTURE_TALKS).markers.reduce((best, marker) => (marker.count > best.count ? marker : best));
const restingPhi = () => facingPhi(busiest().coordinates[1]);
const introPhase = (item: MountedGlobe) => item.globe.querySelector('.wanderer-globe__scene')?.getAttribute('data-wanderer-intro');

/** Runs 16 ms frames until the intro reaches `phase` and returns the phases seen and the frames it took. */
async function runUntil(item: MountedGlobe, phase: string, limit = 600): Promise<{ phases: string[]; frames: number }> {
  const phases: string[] = [introPhase(item)!];
  let frames = 0;
  while (introPhase(item) !== phase && frames < limit) {
    await item.frame(16);
    frames += 1;
    if (phases.at(-1) !== introPhase(item)) phases.push(introPhase(item)!);
  }
  return { phases, frames };
}

const introView = { views: [globeView({ autoRotate: false })] };

describe('FrameLoop', () => {
  function harness() {
    let next = 1;
    const queued = new Map<number, FrameRequestCallback>();
    const previous = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
    globalThis.requestAnimationFrame = (callback) => { queued.set(next, callback); return next++; };
    globalThis.cancelAnimationFrame = (id) => { queued.delete(id); };
    cleanups.push(async () => { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = previous as [typeof requestAnimationFrame, typeof cancelAnimationFrame]; });
    return { queued, flush(now: number) { const batch = [...queued.values()]; queued.clear(); for (const callback of batch) callback(now); } };
  }

  test('a frame requested while paused runs once on resume; resuming twice schedules it once', () => {
    const raf = harness();
    const seen: number[] = [];
    const loop = new FrameLoop((now) => seen.push(now));
    loop.pause();
    loop.request();
    assert.equal(raf.queued.size, 0, 'nothing is scheduled while paused');
    loop.resume();
    loop.resume();
    assert.equal(raf.queued.size, 1);
    raf.flush(16);
    assert.deepEqual(seen, [16]);
  });

  test('pausing cancels the scheduled frame and keeps it pending; cancel drops it', () => {
    const raf = harness();
    const seen: number[] = [];
    const loop = new FrameLoop((now) => seen.push(now));
    loop.request();
    loop.pause();
    assert.equal(raf.queued.size, 0);
    loop.cancel();
    loop.resume();
    assert.equal(raf.queued.size, 0, 'a cancelled request does not come back on resume');
    loop.request();
    loop.request();
    assert.equal(raf.queued.size, 1, 'a second request replaces the first');
    raf.flush(32);
    assert.deepEqual(seen, [32]);
  });
});

describe('intro scene', () => {
  const markers = deriveGeography([
    ...FIXTURE_TALKS,
    ...Array.from({ length: 12 }, (_, index) => talk({ id: `extra-${index}`, coordinates: [-50 + index * 9, -150 + index * 25] })),
  ]).markers;

  test('seeds at most eight clusters, starting with the busiest location', () => {
    const clusters = buildIntroClusters(markers);
    assert.equal(clusters.length, 8);
    assert.deepEqual([clusters[0].lat, clusters[0].lng], [...busiest().coordinates]);
    assert.ok(clusters.every((cluster, index) => index === 0 || cluster.startMs > clusters[index - 1].startMs), 'clusters bloom one after another');
  });

  test('every frame of the sketch draws finite alphas from the first frame to past the end', () => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const scene = { clusters: buildIntroClusters(markers), dots: [] as ReturnType<typeof buildIntroDots> };
    scene.dots = buildIntroDots(scene.clusters, random);
    assert.ok(scene.dots.length > 100, 'land is sketched as a grid of dots');
    const fills: string[] = [];
    const context = {
      clearRect() {}, beginPath() {}, arc() {}, fill() {},
      set fillStyle(value: string) { fills.push(value); },
    } as unknown as CanvasRenderingContext2D;
    for (let elapsed = 0; elapsed <= INTRO_DURATION_MS + 400; elapsed += 50) {
      drawIntroFrame(context, scene, { elapsed, phi: elapsed * 0.00062, width: 400, height: 400, neutral: [0.2, 0.2, 0.2], bloom: [0.1, 0.4, 0.9] });
    }
    assert.ok(fills.length > 1000, 'the sketch draws');
    const alphas = fills.map((fill) => Number(/, ([^,]+)\)$/.exec(fill)?.[1]));
    assert.ok(alphas.every((alpha) => Number.isFinite(alpha) && alpha >= 0), 'no NaN or negative alpha reaches the canvas');
  });
});

describe('parseCssTime', () => {
  test('reads milliseconds and seconds and rejects anything else', () => {
    assert.equal(parseCssTime('920ms'), 920);
    assert.equal(parseCssTime(' 1.5s '), 1500);
    assert.equal(parseCssTime('.25s'), 250);
    assert.equal(parseCssTime(''), null);
    assert.equal(parseCssTime('calc(1s + 2ms)'), null);
    assert.equal(parseCssTime('-1s'), null);
  });
});

describe('the intro in the renderer', () => {
  test('plays through its phases on rendered frames and lands on the busiest location', async () => {
    const item = await mountGlobe(cleanups, introView, { reducedMotion: false, context2d: true, before: (dom) => sizeScene(dom) });
    assert.equal(introPhase(item), 'particles');
    const { phases, frames } = await runUntil(item, 'done');
    assert.deepEqual(phases, ['particles', 'reveal', 'fade', 'done']);
    assert.ok(frames * 16 >= INTRO_DURATION_MS + INTRO_REVEAL_DURATION_MS, 'it took the full intro and cross-fade');
    await item.frame();
    await item.frame();
    assert.ok(Math.abs((item.gl.uniforms.get('z') as number) - restingPhi()) < 1e-9, 'the spin lands exactly on the busiest location');
    assert.ok(item.gl.fills.length > 0 && item.gl.fills.every((fill) => !fill.includes('NaN')), 'the sketch drew with finite colors');
  });

  test('a globe mounted in a hidden tab waits for frames instead of the wall clock', async () => {
    const item = await mountGlobe(cleanups, introView, { reducedMotion: false, context2d: true, hidden: true, before: (dom) => sizeScene(dom) });
    assert.equal(item.stage.getAttribute('data-wanderer-paused'), 'true');
    // Longer than the reveal and handover delays: wall-clock timers would have moved on by now.
    await item.wait(INTRO_DURATION_MS + 100);
    assert.equal(introPhase(item), 'particles', 'nothing advanced while no frame rendered');
    await act(async () => { item.gl.setVisible(true); });
    const { phases } = await runUntil(item, 'done');
    assert.deepEqual(phases, ['particles', 'reveal', 'fade', 'done'], 'the intro plays once the tab is visible');
    await item.frame();
    await item.frame();
    assert.ok(Math.abs((item.gl.uniforms.get('z') as number) - restingPhi()) < 1e-9, 'and still lands on the busiest location');
  });

  test('the sketch stays until a longer --wanderer-globe-reveal-duration has finished', async () => {
    const item = await mountGlobe(cleanups, { ...introView, tokens: { '--wanderer-globe-reveal-duration': '1.8s' } }, { reducedMotion: false, context2d: true, before: (dom) => sizeScene(dom) });
    const { frames: toFade } = await runUntil(item, 'fade');
    assert.ok(toFade * 16 >= INTRO_DURATION_MS);
    // Past the default 920 ms the sketch is still fading.
    for (let index = 0; index < Math.ceil((INTRO_REVEAL_DURATION_MS + 200) / 16); index += 1) await item.frame(16);
    assert.equal(introPhase(item), 'fade');
    assert.ok(item.globe.querySelector('.wanderer-globe__intro'), 'the sketch canvas is still in the DOM mid-fade');
    const { frames } = await runUntil(item, 'done');
    assert.ok((toFade + Math.ceil((INTRO_REVEAL_DURATION_MS + 200) / 16) + frames) * 16 >= INTRO_DURATION_MS + 1800, 'removed only after the token duration');
    assert.equal(item.globe.querySelector('.wanderer-globe__intro'), null);
  });

  test('without a 2D context the intro is skipped but the globe still faces the busiest location', async () => {
    const item = await mountGlobe(cleanups, introView, { reducedMotion: false, before: (dom) => sizeScene(dom) });
    assert.equal(introPhase(item), 'done');
    await item.frame();
    await item.frame();
    assert.ok(Math.abs((item.gl.uniforms.get('z') as number) - restingPhi()) < 1e-9);
  });

  test('reduced motion arriving mid-intro ends it at the landing rotation', async () => {
    const item = await mountGlobe(cleanups, introView, { reducedMotion: false, context2d: true, before: (dom) => sizeScene(dom) });
    for (let index = 0; index < Math.ceil(INTRO_REVEAL_DELAY_MS / 2 / 16); index += 1) await item.frame(16);
    assert.equal(introPhase(item), 'particles');
    await act(async () => { item.dom.setReducedMotion(true); });
    assert.equal(introPhase(item), 'done');
    await item.frame();
    await item.frame();
    assert.ok(Math.abs((item.gl.uniforms.get('z') as number) - restingPhi()) < 1e-9);
  });
});
