import type { Marker } from 'cobe';
import { compareIds } from '../helpers.js';
import type { GlobeMarker } from '../types.js';

/** cobe's fragment shader holds at most this many markers (`uniform vec4 u[64*2]`); the rest are not drawn. */
export const MAX_GLOBE_MARKERS = 64;

/**
 * The markers the globe draws: every marker, or past the cobe limit the
 * busiest MAX_GLOBE_MARKERS (ties by id) in their original order.
 */
export function drawnMarkers(markers: readonly GlobeMarker[]): readonly GlobeMarker[] {
  if (markers.length <= MAX_GLOBE_MARKERS) return markers;
  const kept = new Set([...markers].sort((a, b) => b.count - a.count || compareIds(a.id, b.id)).slice(0, MAX_GLOBE_MARKERS));
  return markers.filter((marker) => kept.has(marker));
}

/** cobe marker radius for a location, stepped by how many talks it hosts. */
export function markerSize(count: number): number {
  return count >= 10 ? 0.07 : count >= 2 ? 0.045 : 0.03;
}

/**
 * The cobe marker list for a set of drawn markers. cobe 0.6.5 counts the
 * markers it draws as `2 * markers.length` at creation but as
 * `markers.length` when `onRender` replaces them, which would draw only the
 * first half. An update therefore appends one size-0 marker per real one:
 * the count comes out right, the padding never draws, and a cobe that counts
 * both cases the same way still draws exactly the real markers.
 */
export function cobeMarkers(markers: readonly GlobeMarker[], update = false): Marker[] {
  const list: Marker[] = markers.map((marker) => ({
    location: [marker.coordinates[0], marker.coordinates[1]],
    size: markerSize(marker.count),
  }));
  if (update) for (let index = markers.length; index > 0; index -= 1) list.push({ location: [0, 0], size: 0 });
  return list;
}

/**
 * A string that changes only when the drawn marker set changes: ids,
 * coordinates, or size steps. Search and filter changes produce new marker
 * arrays every time; this key keeps the drawn set unchanged across them.
 */
export function markerSetKey(markers: readonly GlobeMarker[]): string {
  return markers.map((marker) => `${marker.id}\u0000${marker.coordinates[0]},${marker.coordinates[1]}\u0000${markerSize(marker.count)}`).join('\u0001');
}
