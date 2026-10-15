// Its own file: the renderer import promise is module state, so these tests
// need a process where nothing has loaded the renderer yet.
import { afterEach, describe, test } from 'node:test';
import assert from './support/assert.js';
import { preloadGlobeView } from '../src/globe.js';
import { mountGlobe } from './support/globe.js';
import { spyOnRendererImport } from './support/import-hooks.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('loading the globe renderer', () => {
  test('a renderer chunk that fails to load shows the module fallback, and a later mount retries', async () => {
    const spy = spyOnRendererImport();
    cleanups.push(async () => { spy.restore(); });
    spy.fail = true;
    const failed = await mountGlobe(cleanups);
    assert.equal(failed.globe.getAttribute('data-wanderer-globe-status'), 'error');
    assert.equal(failed.globe.getAttribute('data-wanderer-globe-error'), 'module');
    assert.ok(failed.stage.querySelector('.wanderer-empty'), 'the unavailable fallback with the list button');
    assert.equal(spy.imports, 1);
    // The failed promise is not cached: the next request imports again.
    await assert.rejects(preloadGlobeView());
    assert.equal(spy.imports, 2);

    spy.fail = false;
    const retried = await mountGlobe(cleanups);
    assert.equal(retried.globe.getAttribute('data-wanderer-globe-status'), 'ready');
    assert.equal(retried.globe.hasAttribute('data-wanderer-globe-error'), false);
    assert.equal(spy.imports, 3);
    // A successful import is shared by every later request.
    await Promise.all([preloadGlobeView(), preloadGlobeView()]);
    assert.equal(spy.imports, 3);
  });
});
