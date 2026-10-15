// Mounts <Talks> on the globe view under jsdom and the fake WebGL context, and
// waits for the lazily imported renderer. Cleanups go into the caller's list
// so roots unmount before their DOM globals disappear.
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { Talks } from '../../src/index.js';
import { globeView } from '../../src/globe.js';
import type { TalksProps } from '../../src/component-types.js';
import { installDom, type DomHandle } from './dom.js';
import { loadReactDomClient } from './react.js';
import { installFakeWebGl, type FakeWebGl, type FakeWebGlOptions } from './webgl.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './fixtures.js';

const { createRoot } = await loadReactDomClient();

export interface MountedGlobe {
  dom: DomHandle;
  gl: FakeWebGl;
  root: Root;
  container: HTMLElement;
  section: HTMLElement;
  globe: HTMLElement;
  stage: HTMLElement;
  search: HTMLInputElement;
  /** Renders again with these props merged over the current ones. */
  rerender(props: Partial<TalksProps>): Promise<void>;
  /** Runs one animation frame inside act so renderer state updates are flushed. */
  frame(step?: number): Promise<void>;
  /** Waits real time inside act, for timers such as the context-loss grace period. */
  wait(ms: number): Promise<void>;
}

export interface MountGlobeOptions extends FakeWebGlOptions {
  width?: number;
  reducedMotion?: boolean;
  before?: (dom: DomHandle) => void;
}

export async function mountGlobe(
  cleanups: (() => Promise<void>)[],
  props: Partial<TalksProps> = {},
  options: MountGlobeOptions = {},
): Promise<MountedGlobe> {
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
  // Null when the default view is not the globe; tests of other views ignore it.
  const globe = section.querySelector<HTMLElement>('.wanderer-globe')!;
  // The renderer module loads through a dynamic import; wait for it.
  for (let attempt = 0; attempt < 50 && globe?.getAttribute('data-wanderer-globe-status') === 'loading'; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  return {
    dom, gl, root, container, section, globe,
    stage: globe?.querySelector<HTMLElement>('.wanderer-globe__stage')!,
    search: section.querySelector<HTMLInputElement>('input[type="search"]')!,
    async rerender(next) {
      current = { ...current, ...next };
      await act(async () => { root.render(element()); });
    },
    async frame(step) {
      await act(async () => { gl.frames.flush(step); });
    },
    async wait(ms) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
    },
  };
}
