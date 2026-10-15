import type { Geography, GeographyOptions, GlobeMarker, Talk } from './types.js';
import { compareIds, resolveTalkCoordinates, sortTalks } from './helpers.js';

/**
 * Narrows a geography derived from every talk to a subset of those talks.
 * Markers keep the id, coordinates and label they were merged with, so search
 * and filters change counts and talk lists but never re-host a location.
 * Regions follow the same rules as `deriveGeography` over the kept talks.
 */
export function restrictGeography(base: Geography, talks: readonly Talk[], options: GeographyOptions = {}): Geography {
  const kept = new Set(talks);
  const mappedTalks = base.mappedTalks.filter((talk) => kept.has(talk));
  if (mappedTalks.length === base.mappedTalks.length) return base;
  const markers: GlobeMarker[] = [];
  for (const marker of base.markers) {
    const markerTalks = marker.talks.filter((talk) => kept.has(talk));
    if (!markerTalks.length) continue;
    markers.push(markerTalks.length === marker.talks.length ? marker : {
      ...marker, talks: markerTalks, count: markerTalks.length, latestTalk: sortTalks(markerTalks)[0],
    });
  }
  const regionCounts = new Map<string, number>();
  if (options.assignRegion) {
    for (const talk of mappedTalks) {
      const assigned = options.assignRegion(talk, resolveTalkCoordinates(talk, options)!);
      const region = assigned || (options.unassignedRegion === undefined ? 'Unassigned' : options.unassignedRegion);
      if (region !== null) regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    }
  }
  return {
    mappedTalks,
    mappedCount: mappedTalks.length,
    markers,
    regions: [...regionCounts].sort(([a], [b]) => compareIds(a, b)).map(([id, count]) => ({ id, count, percentage: mappedTalks.length ? count / mappedTalks.length * 100 : 0 })),
  };
}
