// Runs the built dist/esm and dist/cjs output. Every other unit test runs the
// TypeScript sources, so the module-format interop esbuild emits (for example
// how the CommonJS build binds cobe's default export) and the dual-copy hazard
// are only exercised here. `npm test` builds first.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { act, createElement, type ComponentType, type Context } from 'react';
import type { TalksContext, TalksProps } from '../src/component-types.js';
import type { globeView as GlobeViewFactory } from '../src/globe.js';
import { installDom } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';
import { installFakeWebGl } from './support/webgl.js';
import { FIXTURE_TALKS, REFERENCE_DATE } from './support/fixtures.js';

const { createRoot } = await loadReactDomClient();
const require = createRequire(import.meta.url);
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

interface BuiltEntries {
  Talks: ComponentType<TalksProps>;
  globeView: typeof GlobeViewFactory;
}

const formats: Record<'esm' | 'cjs', () => Promise<BuiltEntries>> = {
  esm: async () => {
    const root = await import(pathToFileURL(path.join(distDir, 'esm', 'index.js')).href);
    const globe = await import(pathToFileURL(path.join(distDir, 'esm', 'globe.js')).href);
    return { Talks: root.Talks, globeView: globe.globeView };
  },
  cjs: async () => ({
    Talks: require(path.join(distDir, 'cjs', 'index.js')).Talks,
    globeView: require(path.join(distDir, 'cjs', 'globe.js')).globeView,
  }),
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('the built globe under a fake GL context', () => {
  for (const [format, load] of Object.entries(formats)) {
    const missing = !existsSync(path.join(distDir, format, 'globe', 'renderer.js'));
    test(`dist/${format} lazily loads the renderer and creates the cobe globe`, { skip: missing && 'dist/ is not built; run npm test' }, async () => {
      const { Talks, globeView } = await load();
      const dom = installDom({ width: 1440, reducedMotion: true });
      const gl = installFakeWebGl(dom);
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
      const container = dom.document.getElementById('root')!;
      const root = createRoot(container);
      cleanups.push(async () => {
        await act(async () => { root.unmount(); });
        console.error = originalError;
        gl.cleanup();
        dom.cleanup();
      });
      await act(async () => {
        root.render(createElement(Talks, { talks: FIXTURE_TALKS, referenceDate: REFERENCE_DATE, views: [globeView()], defaultView: 'globe' }));
      });
      const globe = container.querySelector<HTMLElement>('.wanderer-globe')!;
      for (let attempt = 0; attempt < 50 && globe.getAttribute('data-wanderer-globe-status') === 'loading'; attempt += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
      }
      await act(async () => { gl.frames.flush(); });
      assert.deepEqual(errors, [], 'no render errors');
      assert.equal(globe.getAttribute('data-wanderer-globe-status'), 'ready');
      assert.equal(globe.getAttribute('data-wanderer-globe-error'), null);
      assert.ok(globe.querySelector('.wanderer-globe__canvas'), 'the cobe canvas is in the stage');
      assert.equal(gl.programs, 1, 'cobe created one globe');
    });
  }
});

describe('the built ESM and CommonJS copies loaded side by side', () => {
  const missing = !existsSync(path.join(distDir, 'cjs', 'context.js'));
  test('share one React context, so useTalks from one copy sees <Talks> from the other', { skip: missing && 'dist/ is not built; run npm test' }, async () => {
    const esmContext = await import(pathToFileURL(path.join(distDir, 'esm', 'context.js')).href) as { TalksReactContext: Context<TalksContext | null> };
    const cjsContext = require(path.join(distDir, 'cjs', 'context.js')) as { TalksReactContext: Context<TalksContext | null> };
    assert.equal(esmContext.TalksReactContext, cjsContext.TalksReactContext);

    const { Talks } = await import(pathToFileURL(path.join(distDir, 'esm', 'index.js')).href) as { Talks: ComponentType<TalksProps> };
    const { useTalks } = require(path.join(distDir, 'cjs', 'index.js')) as { useTalks: () => TalksContext };
    const dom = installDom({ width: 1440 });
    const container = dom.document.getElementById('root')!;
    const root = createRoot(container);
    cleanups.push(async () => {
      await act(async () => { root.unmount(); });
      dom.cleanup();
    });
    function CommonJsPluginView() {
      return createElement('p', { className: 'from-cjs' }, `${useTalks().talks.length} talks`);
    }
    await act(async () => {
      root.render(createElement(Talks, {
        talks: FIXTURE_TALKS,
        referenceDate: REFERENCE_DATE,
        views: [{ id: 'cjs', label: 'CommonJS', Component: CommonJsPluginView }],
        defaultView: 'cjs',
      }));
    });
    assert.equal(container.querySelector('.from-cjs')?.textContent, `${FIXTURE_TALKS.length} talks`);
  });
});
