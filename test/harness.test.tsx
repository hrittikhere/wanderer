// The test harness itself: the browser APIs it provides and the failures it
// refuses to let pass silently.
import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { act, createElement } from 'react';
import { click, installDom } from './support/dom.js';
import { loadReactDomClient } from './support/react.js';

const { createRoot } = await loadReactDomClient();

describe('installDom', () => {
  test('an exception thrown by an event handler fails cleanup unless the test takes it', async () => {
    for (const take of [true, false]) {
      const dom = installDom();
      const container = dom.document.getElementById('root')!;
      const root = createRoot(container);
      await act(async () => { root.render(createElement('button', { onClick: () => { throw new Error('handler exploded'); } }, 'Go')); });
      const original = console.error;
      console.error = () => {};
      try {
        await act(async () => { click(container.querySelector('button')!, dom.window); });
      } finally {
        console.error = original;
      }
      await act(async () => { root.unmount(); });
      if (take) {
        assert.deepEqual(dom.takeErrors().map(String), ['Error: handler exploded']);
        dom.cleanup();
      } else {
        assert.throws(() => dom.cleanup(), /handler exploded/);
      }
    }
  });

  test('MutationObserver is installed and the observer fakes report only the entries a test sends', async () => {
    const dom = installDom();
    try {
      assert.equal(typeof MutationObserver, 'function');
      const target = dom.document.getElementById('root')!;
      const seen: string[] = [];
      const intersection = new IntersectionObserver(([entry]) => seen.push(`intersect:${entry.isIntersecting}`));
      const resize = new ResizeObserver(([entry]) => seen.push(`resize:${entry.contentRect.width}x${entry.contentRect.height}`));
      intersection.observe(target);
      resize.observe(target);
      assert.deepEqual(seen, [], 'nothing is reported on observe');
      dom.intersect(target, false);
      dom.resize(target, 300, 200);
      assert.deepEqual(seen, ['intersect:false', 'resize:300x200']);
      intersection.disconnect();
      resize.unobserve(target);
      dom.intersect(target, true);
      dom.resize(target, 1, 1);
      assert.equal(seen.length, 2, 'disconnected observers hear nothing');
      assert.deepEqual([dom.observed('intersection'), dom.observed('resize')], [[], []]);
    } finally {
      dom.cleanup();
    }
  });
});
