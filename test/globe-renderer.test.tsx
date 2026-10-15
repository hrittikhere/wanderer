import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { Talks } from '../src/index.js';
import { globeView } from '../src/globe.js';
import type { Milestone, TalksProps } from '../src/component-types.js';
import { facingPhi, projectMarker } from '../src/globe/projection.js';
import { click, installDom, setInputValue, type DomHandle } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { installFakeWebGl, type FakeWebGl, type FakeWebGlOptions } from './support/webgl.js';
import { FIXTURE_TALKS, REFERENCE_DATE, talk } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();

const LISBON: Milestone = { id: 'lisbon', title: 'Lisbon milestone', coordinates: [38.72, -9.14] };

interface Mounted {
  dom: DomHandle;
  gl: FakeWebGl;
  root: Root;
  section: HTMLElement;
  globe: HTMLElement;
  stage: HTMLElement;
  search: HTMLInputElement;
  rerender(props: Partial<TalksProps>): Promise<void>;
  /** Runs one animation frame inside act so renderer state updates are flushed. */
  frame(step?: number): Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function mountGlobe(props: Partial<TalksProps> = {}, options: FakeWebGlOptions & { width?: number; reducedMotion?: boolean; before?: (dom: DomHandle) => void } = {}): Promise<Mounted> {
  const dom = installDom({ width: options.width ?? 1440, reducedMotion: options.reducedMotion ?? true });
  const gl = installFakeWebGl(dom, options);
  options.before?.(dom);
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  cleanups.push(async () => { await act(async () => { root.unmount(); }); gl.cleanup(); dom.cleanup(); });
  let current: Partial<TalksProps> = { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], defaultView: 'globe', ...props };
  const element = () => createElement(Talks, current as TalksProps);
  await act(async () => { root.render(element()); });
  const section = container.querySelector<HTMLElement>('.wanderer')!;
  const globe = section.querySelector<HTMLElement>('.wanderer-globe')!;
  // The renderer module loads through a dynamic import; wait for it.
  for (let attempt = 0; attempt < 50 && globe.getAttribute('data-wanderer-globe-status') === 'loading'; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  return {
    dom, gl, root, section, globe,
    stage: globe.querySelector<HTMLElement>('.wanderer-globe__stage')!,
    search: section.querySelector<HTMLInputElement>('input[type="search"]')!,
    async rerender(next) {
      current = { ...current, ...next };
      await act(async () => { root.render(element()); });
    },
    async frame(step) {
      await act(async () => { gl.frames.flush(step); });
    },
  };
}

describe('the WebGL renderer under a fake GL context', () => {
  test('manual milestones pause the queue and dismissal survives later animation frames', async () => {
    const item = await mountGlobe({ milestones: [LISBON], views: [globeView({ intro: false, autoRotate: false })] }, { reducedMotion: false });
    const select = item.globe.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = 'lisbon'; select.dispatchEvent(new item.dom.window.Event('change', { bubbles: true })); });
    await item.frame(100_000);
    assert.ok(item.globe.querySelector('.wanderer-globe__callout'), 'a selected card stays visible beyond the auto-dismiss interval');
    const dismiss = item.globe.querySelector<HTMLButtonElement>('.wanderer-globe__dismiss')!;
    await act(async () => { click(dismiss, item.dom.window); });
    await item.frame(100_000);
    assert.equal(item.globe.querySelector('.wanderer-globe__callout'), null);
    assert.equal(select.value, '');
    const resume = [...item.globe.querySelectorAll('button')].find((button) => button.textContent === 'Resume animation')!;
    assert.ok(resume, 'manual selection and dismissal pause animation until explicitly resumed');
  });

  test('mounts, probes WebGL once per instance, and releases the probe context', async () => {
    const item = await mountGlobe();
    assert.equal(item.globe.getAttribute('data-wanderer-globe-status'), 'ready');
    assert.ok(item.globe.querySelector('.wanderer-globe__canvas'), 'the cobe canvas is in the stage');
    assert.equal(item.gl.programs, 1, 'one globe created');
    assert.equal(item.gl.probeReleases, 1, 'the support probe released its context');
    // Emptying and refilling the mapped set unmounts and remounts the renderer without probing again.
    for (const query of ['zzzz-nothing', '', 'zzzz-nothing', '']) {
      await act(async () => { setInputValue(item.search, query, item.dom.window); });
    }
    assert.equal(item.globe.getAttribute('data-wanderer-globe-status'), 'ready');
    assert.equal(item.gl.probeReleases, 1, 'the probe runs once per GlobeView instance');
    assert.equal(item.gl.rendererReleases, 2, 'each unmounted renderer released its own context');
  });

  test('search keystrokes never rebuild the globe; a changed marker set is handed to the live globe', async () => {
    const item = await mountGlobe();
    const { gl } = item;
    await item.frame();
    assert.equal(gl.programs, 1);
    assert.equal(gl.uniforms.get('C'), 6, 'cobe counts two vec4 slots per marker: three locations');
    for (const query of ['e', 'er', 'e', '']) {
      await act(async () => { setInputValue(item.search, query, item.dom.window); });
    }
    assert.equal(item.section.querySelectorAll('.wanderer-globe__location').length, 3, 'every location still mapped');
    await item.frame();
    assert.equal(gl.programs, 1, 'same marker set: the globe survives every keystroke');
    await act(async () => { setInputValue(item.search, 'aurora', item.dom.window); });
    assert.equal(item.section.querySelectorAll('.wanderer-globe__location').length, 1);
    // onRender hands the markers over; cobe uploads them on the following frame.
    await item.frame();
    await item.frame();
    assert.equal(gl.programs, 1, 'a different marker set does not compile a new globe');
    assert.equal(gl.uniforms.get('C'), 2, 'the live globe now draws one marker');
    const slots = gl.uniforms.get('u') as number[];
    const sizes = Array.from({ length: (gl.uniforms.get('C') as number) / 2 }, (_, index) => slots[index * 8 + 3]);
    assert.deepEqual(sizes.map((size) => size > 0), [true], 'the drawn slot holds the real marker');
    await act(async () => { setInputValue(item.search, '', item.dom.window); });
    await item.frame();
    await item.frame();
    assert.equal(gl.uniforms.get('C'), 6, 'clearing the search restores every marker');
    assert.equal(gl.programs, 1);
  });

  test('hiding and showing the tab repeatedly leaves exactly one render chain', async () => {
    const item = await mountGlobe();
    const { gl } = item;
    await item.frame();
    const perFrame = () => { const before = gl.clears; gl.frames.flush(); return gl.clears - before; };
    assert.equal(perFrame(), 1, 'one render per frame while visible');
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await act(async () => { gl.setVisible(false); });
      assert.equal(item.stage.getAttribute('data-wanderer-paused'), 'true');
      await act(async () => { gl.setVisible(true); });
      assert.equal(item.stage.hasAttribute('data-wanderer-paused'), false);
      // The frame queued before the pause and the deferred resume both run in this frame.
      await item.frame();
    }
    assert.equal(perFrame(), 1, 'four hide/show cycles later there is still one chain, not five');
    assert.equal(perFrame(), 1);
    await act(async () => { gl.setVisible(false); });
    await item.frame();
    assert.equal(perFrame(), 0, 'no frames render while hidden');
  });

  test('scrolling the stage offscreen pauses rendering and scrolling back resumes one chain', async () => {
    const item = await mountGlobe();
    const { gl, dom } = item;
    await item.frame();
    const perFrame = () => { const before = gl.clears; gl.frames.flush(); return gl.clears - before; };
    assert.ok(dom.observed('intersection').includes(item.stage), 'the stage is watched for visibility');
    await act(async () => { dom.intersect(item.stage, false); });
    assert.equal(item.stage.getAttribute('data-wanderer-paused'), 'true');
    await item.frame();
    assert.equal(perFrame(), 0, 'no frames render offscreen');
    await act(async () => { dom.intersect(item.stage, true); });
    assert.equal(item.stage.hasAttribute('data-wanderer-paused'), false);
    await item.frame();
    assert.equal(perFrame(), 1);
    await act(async () => { item.root.unmount(); });
    assert.deepEqual(dom.observed('intersection'), [], 'unmounting disconnects the observer');
    assert.deepEqual(dom.observed('resize'), []);
  });

  test('a resized scene resizes the drawing buffer', async () => {
    const item = await mountGlobe();
    const { gl, dom } = item;
    const scene = item.globe.querySelector<HTMLElement>('.wanderer-globe__scene')!;
    assert.ok(dom.observed('resize').includes(scene), 'the scene is watched for size changes');
    await act(async () => { dom.resize(scene, 320, 320); });
    await item.frame();
    await item.frame();
    assert.deepEqual(gl.uniforms.get('w'), [320, 320]);
    await act(async () => { dom.resize(scene, 480, 480); });
    await item.frame();
    await item.frame();
    assert.deepEqual(gl.uniforms.get('w'), [480, 480]);
  });

  test('a lost WebGL context pauses rendering and a restored one rebuilds the globe', async () => {
    const item = await mountGlobe({ milestones: [LISBON] });
    const { gl, dom } = item;
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await item.frame();
    const lost = new dom.window.Event('webglcontextlost', { cancelable: true });
    await act(async () => { canvas.dispatchEvent(lost); });
    assert.equal(lost.defaultPrevented, true, 'the renderer asks the browser to restore the context');
    await item.frame();
    const before = gl.clears;
    gl.frames.flush();
    assert.equal(gl.clears, before, 'nothing renders on a lost context');
    assert.equal(item.globe.getAttribute('data-wanderer-globe-status'), 'ready', 'a transient loss is not an error');
    assert.equal(gl.programs, 1);
    await act(async () => { canvas.dispatchEvent(new dom.window.Event('webglcontextrestored')); });
    assert.equal(gl.programs, 2, 'the globe is rebuilt on the restored context');
    await item.frame();
    const after = gl.clears;
    gl.frames.flush();
    assert.equal(gl.clears - after, 1, 'the rebuilt globe renders again, with one chain');
  });

  test('a context that never comes back gives way to the runtime fallback after the grace period', async () => {
    const item = await mountGlobe();
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    await act(async () => { canvas.dispatchEvent(new item.dom.window.Event('webglcontextlost', { cancelable: true })); });
    assert.equal(item.globe.getAttribute('data-wanderer-globe-status'), 'ready');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); });
    assert.equal(item.globe.getAttribute('data-wanderer-globe-status'), 'error');
    assert.equal(item.globe.getAttribute('data-wanderer-globe-error'), 'runtime');
    assert.ok(item.globe.querySelector('.wanderer-empty'), 'the fallback with the list button is shown');
  });

  test('a renderer that throws sets status error with kind runtime', async () => {
    const originalError = console.error;
    console.error = () => {};
    cleanups.push(async () => { console.error = originalError; });
    const item = await mountGlobe({}, { deny: (canvas) => canvas.classList.contains('wanderer-globe__canvas') });
    assert.equal(item.globe.getAttribute('data-wanderer-globe-status'), 'error');
    assert.equal(item.globe.getAttribute('data-wanderer-globe-error'), 'runtime');
    assert.ok(item.globe.querySelector('.wanderer-empty'));
  });

  test('the milestone callout disappears with the renderer and does not linger over the empty state', async () => {
    const item = await mountGlobe({ milestones: [LISBON] });
    const { gl } = item;
    await item.frame();
    // Reduced motion keeps automatic callouts off; the accessible selector
    // makes the same content available without timed rotation.
    const select = item.globe.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = 'lisbon'; select.dispatchEvent(new item.dom.window.Event('change', { bubbles: true })); });
    await item.frame(3000);
    const callout = item.globe.querySelector('.wanderer-globe__callout');
    assert.ok(callout, 'a milestone callout is shown');
    assert.equal(callout?.getAttribute('data-wanderer-milestone'), 'lisbon');
    assert.ok(item.globe.querySelector('.wanderer-globe__milestone-dot[data-wanderer-active="true"]'));
    await act(async () => { setInputValue(item.search, 'zzzz-nothing', item.dom.window); });
    assert.ok(item.stage.querySelector('.wanderer-empty'), 'the empty state replaced the renderer');
    assert.ok(item.globe.querySelector('.wanderer-globe__callout') === null, 'the stale callout is gone');
    await act(async () => { setInputValue(item.search, '', item.dom.window); });
    assert.ok(item.globe.querySelector('.wanderer-globe__callout') === null, 'the remounted renderer starts without a callout');
    assert.equal(gl.programs, 2);
  });

  test('the stage and its controls come before the location panel in DOM and focus order', async () => {
    const item = await mountGlobe({ milestones: [LISBON] });
    const layout = item.globe.querySelector('.wanderer-globe__layout')!;
    assert.deepEqual([...layout.children].map((child) => child.className), ['wanderer-globe__stage-wrap', 'wanderer-globe__panel']);
    const focusable = [...item.globe.querySelectorAll('button, select')];
    const lastControl = focusable.findIndex((element) => element.tagName === 'SELECT');
    const firstLocation = focusable.findIndex((element) => element.classList.contains('wanderer-globe__location-button'));
    assert.ok(lastControl >= 0 && lastControl < firstLocation, 'Pause and Milestones are reached before the locations');
  });

  test('milestones that repeat an id render once, keeping the first', async () => {
    const copy: Milestone = { ...LISBON, title: 'Copy-pasted milestone', coordinates: [52.52, 13.405] };
    const item = await mountGlobe({ milestones: [LISBON, copy] });
    const options = [...item.globe.querySelectorAll('select option')].map((option) => option.textContent);
    assert.deepEqual(options, ['Choose a milestone', 'Lisbon milestone']);
    assert.equal(item.globe.querySelectorAll('.wanderer-globe__milestone-dot').length, 1);
  });

  test('the callout sits beside the stage only when the column has room, and connectors follow', async () => {
    const stubRects = (dom: DomHandle, columnRight: number) => {
      Object.defineProperty(dom.window.Element.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function getBoundingClientRect(this: Element) {
          if (this.classList.contains('wanderer-globe__stage')) return { left: 0, right: 500, top: 0, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON() {} };
          if (this.classList.contains('wanderer-globe__stage-wrap')) return { left: 0, right: columnRight, top: 0, bottom: 500, width: columnRight, height: 500, x: 0, y: 0, toJSON() {} };
          return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
        },
      });
    };
    // 500px stage in a 900px column: 400px free, the 13rem card plus the 4% offset needs 236px.
    const roomy = await mountGlobe({ milestones: [LISBON] }, { before: (dom) => stubRects(dom, 900) });
    assert.equal(roomy.stage.getAttribute('data-wanderer-callout'), 'beside');
    assert.ok(roomy.globe.querySelector('.wanderer-globe__connectors'), 'connectors are drawn toward the card beside the stage');
    // 500px stage in a 700px column at a large viewport: 200px free is not enough, so the card overlays the stage.
    const tight = await mountGlobe({ milestones: [LISBON] }, { before: (dom) => stubRects(dom, 700) });
    assert.equal(tight.stage.getAttribute('data-wanderer-callout'), 'below');
    assert.ok(tight.globe.querySelector('.wanderer-globe__connectors') === null, 'no connectors toward an overlaid card');
  });

  test('a search keystroke does not rotate the globe back to the expanded location after the user dragged away', async () => {
    const item = await mountGlobe({}, {
      before: (dom) => {
        // The renderer reads the stage size from clientWidth/Height, which jsdom reports as 0.
        for (const name of ['clientWidth', 'clientHeight']) {
          Object.defineProperty(dom.window.HTMLElement.prototype, name, {
            configurable: true,
            get(this: HTMLElement) { return this.classList.contains('wanderer-globe__scene') ? 400 : 0; },
          });
        }
      },
    });
    const { dom } = item;
    const canvas = item.globe.querySelector<HTMLCanvasElement>('.wanderer-globe__canvas')!;
    const pointer = (type: string, x: number, y = 200) => {
      const event = new dom.window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' });
      canvas.dispatchEvent(event);
    };
    const lisbonButton = [...item.section.querySelectorAll<HTMLButtonElement>('.wanderer-globe__location-button')]
      .find((button) => button.textContent?.includes('Lisbon'))!;
    await act(async () => { click(lisbonButton, dom.window); });
    await item.frame();
    // Lisbon faces the viewer: hovering its projected position shows its tooltip.
    const facing = projectMarker(38.72, -9.14, facingPhi(-9.14));
    const hoverLisbon = async () => { await act(async () => { pointer('pointermove', facing.x * 400, facing.y * 400); }); };
    await hoverLisbon();
    assert.ok(item.globe.querySelector('.wanderer-globe__tooltip')?.textContent?.includes('Lisbon'), 'tooltip at the focused location');
    // Drag the globe a radian away.
    await act(async () => { pointer('pointerdown', 100); pointer('pointermove', 300); pointer('pointerup', 300); });
    await item.frame();
    await hoverLisbon();
    assert.ok(item.globe.querySelector('.wanderer-globe__tooltip') === null, 'Lisbon has rotated away');
    // A keystroke that keeps the marker set must not re-run the focus rotation.
    await act(async () => { setInputValue(item.search, 'e', dom.window); });
    await item.frame();
    await hoverLisbon();
    assert.ok(item.globe.querySelector('.wanderer-globe__tooltip') === null, 'the globe stayed where the user left it');
  });
});

describe('marker identity under search and filters', () => {
  test('filtering out the host talk keeps the location, its open panel and the WebGL globe', async () => {
    const berlin = (id: string, tags: string[]) => talk({ id, tags, location: 'Berlin, Germany', coordinates: [52.52, 13.405] });
    const item = await mountGlobe({ talks: [berlin('berlin-a', []), berlin('berlin-b', ['kept']), berlin('berlin-c', ['kept'])] });
    assert.equal(item.gl.programs, 1);
    const button = () => item.section.querySelector<HTMLButtonElement>('.wanderer-globe__location-button')!;
    await act(async () => { click(button(), item.dom.window); });
    assert.equal(button().getAttribute('aria-expanded'), 'true');
    // Drops the lowest-id host while two talks stay, so the marker size step is unchanged.
    await act(async () => { setInputValue(item.search, 'kept', item.dom.window); });
    assert.equal(item.section.querySelectorAll('.wanderer-globe__location').length, 1);
    assert.match(item.section.querySelector('.wanderer-globe__location-summary')!.textContent!, /2 talks/);
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'the open location stays open');
    assert.equal(item.gl.programs, 1, 'the drawn marker set is unchanged, so the globe is not rebuilt');
    await act(async () => { setInputValue(item.search, '', item.dom.window); });
    assert.equal(button().getAttribute('aria-expanded'), 'true');
    assert.equal(item.gl.programs, 1);
  });
});
