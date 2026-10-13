import type { GlobeMarker } from '../types.js';

/** cobe marker radius for a location, stepped by how many talks it hosts. */
export function markerSize(count: number): number {
  return count >= 10 ? 0.07 : count >= 2 ? 0.045 : 0.03;
}

/**
 * A string that changes only when the drawn marker set changes: ids,
 * coordinates, or size steps. Search and filter changes produce new marker
 * arrays every time; this key keeps the WebGL globe alive across them.
 */
export function markerSetKey(markers: readonly GlobeMarker[]): string {
  return markers.map((marker) => `${marker.id}\u0000${marker.coordinates[0]},${marker.coordinates[1]}\u0000${markerSize(marker.count)}`).join('\u0001');
}
