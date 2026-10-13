import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGeography, geographicDistanceKm, resolveTalkCoordinates } from '../src/helpers.js';
import { talk } from './support/fixtures.js';

describe('geographicDistanceKm', () => {
  test('measures known distances and treats the antimeridian as continuous', () => {
    assert.equal(geographicDistanceKm([0, 0], [0, 0]), 0);
    const equatorDegree = geographicDistanceKm([0, 0], [0, 1]);
    assert.ok(Math.abs(equatorDegree - 111.19) < 0.1, `one degree on the equator is about 111 km, got ${equatorDegree}`);
    const acrossDateline = geographicDistanceKm([0, 179.9], [0, -179.9]);
    assert.ok(acrossDateline < 25, `dateline crossing must be short, got ${acrossDateline}`);
    assert.ok(Math.abs(geographicDistanceKm([90, 0], [-90, 0]) - 20015) < 5, 'pole to pole is half the circumference');
  });
});

describe('resolveTalkCoordinates', () => {
  test('uses explicit coordinates, falls back to the resolver only when absent, never for online talks', () => {
    const resolver = () => [10, 20] as const;
    assert.deepEqual(resolveTalkCoordinates(talk({ id: 'a', coordinates: [1, 2] }), { resolveCoordinates: resolver }), [1, 2]);
    assert.deepEqual(resolveTalkCoordinates(talk({ id: 'b' }), { resolveCoordinates: resolver }), [10, 20]);
    assert.equal(resolveTalkCoordinates(talk({ id: 'c', format: 'online', coordinates: [1, 2] })), undefined);
    assert.equal(resolveTalkCoordinates(talk({ id: 'd', format: 'online' }), { resolveCoordinates: resolver }), undefined);
    assert.equal(resolveTalkCoordinates(talk({ id: 'e' }), { resolveCoordinates: () => [200, 0] }), undefined, 'invalid resolver output is ignored');
    assert.equal(resolveTalkCoordinates(talk({ id: 'f' })), undefined);
  });
});

describe('deriveGeography', () => {
  const lisbonA = talk({ id: 'lisbon-a', location: 'Lisbon, Portugal', coordinates: [38.72, -9.14], date: '2029-01-01' });
  const lisbonB = talk({ id: 'lisbon-b', location: 'Lisboa', coordinates: [38.75, -9.10], date: '2030-01-01' });
  const porto = talk({ id: 'porto', location: 'Porto, Portugal', coordinates: [41.15, -8.61], date: '2028-01-01' });
  const tokyo = talk({ id: 'tokyo', location: 'Tokyo, Japan', coordinates: [35.68, 139.69] });
  const online = talk({ id: 'online', format: 'online', coordinates: [0, 0] });

  test('merges markers within mergeDistanceKm and counts talks per marker', () => {
    const geography = deriveGeography([porto, lisbonB, lisbonA, tokyo, online]);
    assert.equal(geography.mappedCount, 4);
    assert.deepEqual(geography.mappedTalks.map((item) => item.id), ['lisbon-a', 'lisbon-b', 'porto', 'tokyo']);
    assert.deepEqual(geography.markers.map((marker) => [marker.id, marker.count]), [['lisbon-a', 2], ['porto', 1], ['tokyo', 1]]);
    const lisbon = geography.markers[0];
    assert.deepEqual(lisbon.coordinates, [38.72, -9.14], 'the host keeps its coordinates');
    assert.equal(lisbon.label, 'Lisbon, Portugal');
    assert.equal(lisbon.latestTalk.id, 'lisbon-b');
    assert.deepEqual(lisbon.talks.map((item) => item.id), ['lisbon-a', 'lisbon-b']);
  });

  test('host selection is deterministic: the lowest id hosts regardless of input order', () => {
    const forward = deriveGeography([lisbonA, lisbonB]);
    const reversed = deriveGeography([lisbonB, lisbonA]);
    assert.equal(forward.markers[0].id, 'lisbon-a');
    assert.equal(reversed.markers[0].id, 'lisbon-a');
    assert.deepEqual(forward, reversed);
  });

  test('merges across the antimeridian', () => {
    const east = talk({ id: 'east', coordinates: [0, 179.9] });
    const west = talk({ id: 'west', coordinates: [0, -179.9] });
    const geography = deriveGeography([west, east]);
    assert.equal(geography.markers.length, 1);
    assert.equal(geography.markers[0].id, 'east');
    assert.equal(geography.markers[0].count, 2);
  });

  test('online talks are never mapped even with coordinates or a resolver', () => {
    const geography = deriveGeography([online], { resolveCoordinates: () => [1, 1] });
    assert.equal(geography.mappedCount, 0);
    assert.deepEqual(geography.markers, []);
  });

  test('empty or all-online input gives mappedCount 0, no markers, and no NaN anywhere', () => {
    for (const input of [[], [online, talk({ id: 'online-2', format: 'online' })]]) {
      const geography = deriveGeography(input, { assignRegion: () => 'Europe' });
      assert.equal(geography.mappedCount, 0);
      assert.deepEqual(geography.markers, []);
      assert.deepEqual(geography.regions, []);
      assert.equal(JSON.stringify(geography).includes('null'), false, 'NaN would serialize as null');
    }
  });

  test('regions are only produced when assignRegion is supplied, and percentages use mapped talks as the denominator', () => {
    assert.deepEqual(deriveGeography([lisbonA, tokyo]).regions, []);
    const geography = deriveGeography([lisbonA, lisbonB, porto, tokyo, online], {
      assignRegion: (item) => (item.id === 'tokyo' ? 'Asia' : 'Europe'),
    });
    assert.deepEqual(geography.regions, [{ id: 'Asia', count: 1, percentage: 25 }, { id: 'Europe', count: 3, percentage: 75 }]);
  });

  test('unassigned talks get the default label, a custom label, or are hidden while staying in the denominator', () => {
    const assignRegion = (item: { id: string }) => (item.id === 'tokyo' ? 'Asia' : null);
    const defaults = deriveGeography([lisbonA, tokyo], { assignRegion });
    assert.deepEqual(defaults.regions, [{ id: 'Asia', count: 1, percentage: 50 }, { id: 'Unassigned', count: 1, percentage: 50 }]);
    const custom = deriveGeography([lisbonA, tokyo], { assignRegion, unassignedRegion: 'Other' });
    assert.deepEqual(custom.regions.map((region) => region.id), ['Asia', 'Other']);
    const hidden = deriveGeography([lisbonA, tokyo], { assignRegion, unassignedRegion: null });
    assert.deepEqual(hidden.regions, [{ id: 'Asia', count: 1, percentage: 50 }]);
    assert.equal(hidden.mappedCount, 2);
  });

  test('resolveCoordinates is consulted only for talks without coordinates', () => {
    const calls: string[] = [];
    const geography = deriveGeography([lisbonA, talk({ id: 'no-coords', location: 'Madrid, Spain' }), online], {
      resolveCoordinates: (item) => { calls.push(item.id); return [40.42, -3.70]; },
    });
    assert.deepEqual(calls, ['no-coords']);
    assert.deepEqual(geography.markers.map((marker) => marker.id), ['lisbon-a', 'no-coords']);
    assert.equal(geography.markers[1].label, 'Madrid, Spain');
  });

  test('a marker without a location label falls back to its coordinates', () => {
    const geography = deriveGeography([talk({ id: 'bare', coordinates: [12.5, -7.25] })]);
    assert.equal(geography.markers[0].label, '12.5, -7.25');
  });

  test('mergeDistanceKm 0 merges identical points only', () => {
    const same = talk({ id: 'same', coordinates: [38.72, -9.14] });
    const near = talk({ id: 'near', coordinates: [38.7201, -9.14] });
    const geography = deriveGeography([lisbonA, same, near], { mergeDistanceKm: 0 });
    assert.deepEqual(geography.markers.map((marker) => [marker.id, marker.count]), [['lisbon-a', 2], ['near', 1]]);
  });

  test('a large mergeDistanceKm merges everything into the nearest existing host', () => {
    const geography = deriveGeography([lisbonA, porto, tokyo], { mergeDistanceKm: 1000 });
    assert.deepEqual(geography.markers.map((marker) => [marker.id, marker.count]), [['lisbon-a', 2], ['tokyo', 1]]);
  });

  test('invalid mergeDistanceKm throws a RangeError', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => deriveGeography([lisbonA], { mergeDistanceKm: value }), RangeError);
    }
  });

  test('never mutates the input talks', () => {
    const input = [lisbonA, lisbonB];
    const snapshot = JSON.stringify(input);
    deriveGeography(input, { assignRegion: () => 'Europe' });
    assert.equal(JSON.stringify(input), snapshot);
  });
});
