import { describe, test } from 'node:test';
import assert from './support/assert.js';
import { deriveGeography, geographicDistanceKm, locationParts, resolveTalkCoordinates } from '../src/helpers.js';
import { restrictGeography } from '../src/geography.js';
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

  test('a host without a location takes the first label among its merged talks', () => {
    const host = talk({ id: 'a-host', coordinates: [38.72, -9.14] });
    const bare = talk({ id: 'b-bare', coordinates: [38.72, -9.14] });
    const labeled = talk({ id: 'c-lisbon', location: 'Lisbon, Portugal', coordinates: [38.72, -9.14] });
    const later = talk({ id: 'd-lisboa', location: 'Lisboa', coordinates: [38.72, -9.14] });
    const geography = deriveGeography([later, labeled, bare, host]);
    assert.deepEqual(geography.markers.map((marker) => [marker.id, marker.label, marker.count]), [['a-host', 'Lisbon, Portugal', 4]]);
    assert.equal(deriveGeography([host, bare]).markers[0].label, '38.72, -9.14', 'no label anywhere keeps the coordinates');
  });

  test('equidistant hosts: the lowest host id wins', () => {
    const west = talk({ id: 'b-west', coordinates: [0, -0.2] });
    const east = talk({ id: 'c-east', coordinates: [0, 0.2] });
    const middle = talk({ id: 'z-middle', coordinates: [0, 0] });
    const geography = deriveGeography([middle, east, west], { mergeDistanceKm: 30 });
    assert.deepEqual(geography.markers.map((marker) => [marker.id, marker.count]), [['b-west', 2], ['c-east', 1]]);
  });

  test('mergeDistanceKm 0 merges both encodings of an antimeridian or pole point', () => {
    const pairs: [[number, number], [number, number]][] = [[[0, 180], [0, -180]], [[90, 0], [90, 10]], [[-90, 0], [-90, 180]]];
    for (const [a, b] of pairs) {
      const geography = deriveGeography([talk({ id: 'a', coordinates: a }), talk({ id: 'b', coordinates: b })], { mergeDistanceKm: 0 });
      assert.deepEqual(geography.markers.map((marker) => [marker.id, marker.count]), [['a', 2]], `${a} and ${b} are one point`);
    }
    const apart = deriveGeography([talk({ id: 'a', coordinates: [0, 179.99] }), talk({ id: 'b', coordinates: [0, -180] })], { mergeDistanceKm: 0 });
    assert.equal(apart.markers.length, 2, 'nearby but distinct points stay separate');
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

describe('deriveGeography at scale', () => {
  /** The specification: every talk in id order joins the nearest earlier host within reach, lowest host id on ties. */
  function reference(talks: ReturnType<typeof talk>[], mergeDistanceKm: number) {
    const hosts: { id: string; coordinates: readonly [number, number]; ids: string[] }[] = [];
    for (const item of [...talks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      let best: (typeof hosts)[number] | undefined;
      let bestDistance = Infinity;
      for (const host of hosts) {
        const distance = geographicDistanceKm(host.coordinates, item.coordinates!);
        if ((distance <= mergeDistanceKm || distance < 1e-6) && distance < bestDistance) { best = host; bestDistance = distance; }
      }
      if (best) best.ids.push(item.id);
      else hosts.push({ id: item.id, coordinates: item.coordinates!, ids: [item.id] });
    }
    return hosts.map((host) => [host.id, host.ids]);
  }

  test('matches the brute-force merge on random points, including poles and the antimeridian', () => {
    let seed = 42;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const talks = Array.from({ length: 600 }, (_, index) => {
      const kind = index % 6;
      const coordinates: [number, number] = kind === 0 ? [90, random() * 360 - 180]
        : kind === 1 ? [random() * 2 - 1, random() < 0.5 ? 180 : -180 + random() * 0.5]
          : [Math.round((random() * 170 - 85) * 10) / 10, Math.round((random() * 360 - 180) * 10) / 10];
      return talk({ id: `t${String(index).padStart(4, '0')}`, coordinates });
    });
    for (const mergeDistanceKm of [0, 1, 64, 500, 5000, 30000]) {
      const geography = deriveGeography(talks, { mergeDistanceKm });
      assert.deepEqual(
        geography.markers.map((marker) => [marker.id, marker.talks.map((item) => item.id)]),
        reference(talks, mergeDistanceKm),
        `mergeDistanceKm ${mergeDistanceKm}`,
      );
    }
  });

  test('cost grows with talks, not talks times locations, even when every location shares a latitude', () => {
    // 5000 distinct locations about 6 km apart on one parallel, so none merge at 1 km.
    const places = Array.from({ length: 5000 }, (_, index) => [40, -180 + index * 0.07] as [number, number]);
    const talks = Array.from({ length: 20000 }, (_, index) => talk({ id: `t${index}`, coordinates: places[index % places.length] }));
    const started = performance.now();
    const geography = deriveGeography(talks, { mergeDistanceKm: 1 });
    const elapsed = performance.now() - started;
    // Comparing every talk with every host is 20000 x 5000 haversines, seconds; the grid looks at a handful each.
    assert.ok(elapsed < 1500, `took ${elapsed} ms`);
    assert.equal(geography.markers.length, 5000);
    assert.equal(geography.mappedCount, 20000);
  });
});

describe('locationParts', () => {
  test('splits on the first and last comma after trimming and dropping empty segments', () => {
    assert.deepEqual(locationParts('Lisbon, Portugal'), { city: 'Lisbon', country: 'Portugal' });
    assert.deepEqual(locationParts('Washington, D.C., United States'), { city: 'Washington', country: 'United States' });
    assert.deepEqual(locationParts('Lisbon'), { city: 'Lisbon' });
    assert.deepEqual(locationParts(', Portugal'), { city: 'Portugal' });
    assert.deepEqual(locationParts('Lisbon,'), { city: 'Lisbon' });
    assert.deepEqual(locationParts('Lisbon, , Portugal'), { city: 'Lisbon', country: 'Portugal' });
    assert.deepEqual(locationParts(' , '), {});
    assert.deepEqual(locationParts(undefined), {});
    assert.deepEqual(locationParts({ city: '', country: 'Portugal' }), { city: '', country: 'Portugal' });
  });
});

describe('restrictGeography', () => {
  const a = talk({ id: 'a', location: 'Lisbon, Portugal', coordinates: [38.72, -9.14], date: '2029-01-01' });
  const b = talk({ id: 'b', location: 'Lisboa', coordinates: [38.75, -9.10], date: '2031-01-01' });
  const c = talk({ id: 'c', coordinates: [38.72, -9.14], date: '2030-01-01' });
  const tokyo = talk({ id: 'tokyo', location: 'Tokyo, Japan', coordinates: [35.68, 139.69] });
  const options = { assignRegion: (item: { id: string }) => (item.id === 'tokyo' ? 'Asia' : 'Europe') };
  const base = deriveGeography([a, b, c, tokyo], options);

  test('keeps marker id, coordinates and label when the host talk is filtered out', () => {
    const geography = restrictGeography(base, [c, tokyo, b], options);
    const lisbon = geography.markers[0];
    assert.deepEqual([lisbon.id, lisbon.coordinates, lisbon.label, lisbon.count], ['a', [38.72, -9.14], 'Lisbon, Portugal', 2]);
    assert.deepEqual(lisbon.talks.map((item) => item.id), ['b', 'c']);
    assert.equal(lisbon.latestTalk.id, 'b');
    assert.deepEqual(geography.mappedTalks.map((item) => item.id), ['b', 'c', 'tokyo']);
    assert.equal(geography.mappedCount, 3);
    assert.deepEqual(geography.regions.map((region) => [region.id, region.count]), [['Asia', 1], ['Europe', 2]]);
    assert.equal(geography.markers[1], base.markers[1], 'untouched markers keep their identity');
  });

  test('drops empty markers and returns the base itself when every mapped talk is kept', () => {
    assert.deepEqual(restrictGeography(base, [tokyo], options).markers.map((marker) => marker.id), ['tokyo']);
    assert.equal(restrictGeography(base, [tokyo, c, b, a], options), base);
    const empty = restrictGeography(base, [], options);
    assert.deepEqual([empty.markers, empty.regions, empty.mappedCount], [[], [], 0]);
  });
});
