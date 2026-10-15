import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { compositeOver, parseCssColor } from '../src/globe/colors.js';
import { markerSetKey, markerSize } from '../src/globe/markers.js';
import type { GlobeMarker } from '../src/types.js';
import { talk } from './support/fixtures.js';

describe('parseCssColor', () => {
  test('parses rgb and rgba in comma and slash syntax, keeping alpha', () => {
    assert.deepEqual(parseCssColor('rgb(255, 0, 0)'), [1, 0, 0, 1]);
    assert.deepEqual(parseCssColor('rgba(255, 0, 0, 0.25)'), [1, 0, 0, 0.25]);
    assert.deepEqual(parseCssColor('rgb(0 0 255 / 0.5)'), [0, 0, 1, 0.5]);
    assert.deepEqual(parseCssColor('rgb(0 0 255 / 50%)'), [0, 0, 1, 0.5]);
    assert.deepEqual(parseCssColor('rgba(0, 0, 0, 0)'), [0, 0, 0, 0]);
  });

  test('rejects malformed channels instead of returning NaN', () => {
    assert.equal(parseCssColor('rgb(., ., .)'), null);
    assert.equal(parseCssColor('rgb(1.2.3, 0, 0)'), null);
    assert.equal(parseCssColor('rgb(1, 2)'), null);
    assert.equal(parseCssColor('rgb(1, 2, 3, 4, 5)'), null);
    assert.equal(parseCssColor('rgba(1, 2, 3, .)'), null);
  });

  test('runs in linear time on long whitespace runs', () => {
    const spaces = ' '.repeat(1500);
    const started = performance.now();
    assert.equal(parseCssColor(`rgb(1${spaces}2${spaces}x`), null);
    assert.deepEqual(parseCssColor(`rgb(1${spaces}2${spaces}3)`), [1 / 255, 2 / 255, 3 / 255, 1]);
    assert.ok(performance.now() - started < 200, 'no polynomial backtracking');
  });

  test('returns null for other color spaces so they go through the canvas path', () => {
    assert.equal(parseCssColor('oklch(0.7 0.2 30)'), null);
    assert.equal(parseCssColor('color(srgb 1 0 0)'), null);
    assert.equal(parseCssColor('lab(50% 40 60)'), null);
    assert.equal(parseCssColor(''), null);
  });
});

describe('compositeOver', () => {
  test('composites alpha over the base and leaves opaque colors untouched', () => {
    assert.deepEqual(compositeOver([1, 0, 0, 1], [0, 0, 0]), [1, 0, 0]);
    assert.deepEqual(compositeOver([1, 0, 0, 0.25], [1, 1, 1]), [1, 0.75, 0.75]);
    assert.deepEqual(compositeOver([0, 0, 0, 0], [0.2, 0.4, 0.6]), [0.2, 0.4, 0.6]);
  });
});

describe('markerSetKey', () => {
  const marker = (id: string, coordinates: [number, number], count: number): GlobeMarker => {
    const first = talk({ id: `${id}-talk` });
    return { id, coordinates, label: id, count, talks: [first], latestTalk: first };
  };

  test('is identical for structurally equal marker sets and changes with ids, coordinates, or size steps', () => {
    const base = [marker('a', [1, 2], 1), marker('b', [3, 4], 2)];
    assert.equal(markerSetKey(base), markerSetKey(base.map((item) => ({ ...item, talks: [...item.talks] }))));
    assert.notEqual(markerSetKey(base), markerSetKey([base[0]]));
    assert.notEqual(markerSetKey(base), markerSetKey([marker('a', [1, 2.5], 1), base[1]]));
    assert.notEqual(markerSetKey(base), markerSetKey([base[0], marker('b', [3, 4], 10)]), 'count crossing a size step changes the key');
    assert.equal(markerSetKey(base), markerSetKey([base[0], marker('b', [3, 4], 5)]), 'count within one size step keeps the key');
    assert.ok(markerSize(1) < markerSize(2) && markerSize(2) < markerSize(10), 'one, two and ten talks start the three size steps');
    assert.equal(markerSize(9), markerSize(2), 'two to nine talks share a step');
    assert.equal(markerSize(250), markerSize(10), 'ten or more share the largest');
  });
});
