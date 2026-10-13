// Pure projection math shared by the renderer, the intro particle system, and
// the milestone tracker. It mirrors the camera cobe uses: a fixed tilt (THETA)
// and a sphere of radius R in normalized stage coordinates (0..1 on both axes).

/** Camera tilt in radians, matching the `theta` passed to cobe. */
export const THETA = 0.3;
/** Globe radius as a fraction of the (square) stage. */
export const R = 0.4;

export interface Projection {
  /** Horizontal position as a fraction of the stage width. */
  x: number;
  /** Vertical position as a fraction of the stage height. */
  y: number;
  /** True when the point is on the hemisphere facing the viewer. */
  visible: boolean;
  /** Depth toward the viewer in -1..1; 1 is dead center. */
  sz: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Cubic ease-out used for the focus rotation and the connector reveal. */
export function easeOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return 1 - (1 - t) ** 3;
}

/** Projects a latitude/longitude onto the stage for a given rotation `phi`. */
export function projectMarker(lat: number, lng: number, phi: number): Projection {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const cosLat = Math.cos(latRad);
  const ex = cosLat * Math.cos(lngRad);
  const ey = Math.sin(latRad);
  const ez = -cosLat * Math.sin(lngRad);

  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(THETA);
  const st = Math.sin(THETA);

  const sx = cp * ex + sp * ez;
  const sy = sp * st * ex + ct * ey - cp * st * ez;
  const sz = -sp * ct * ex + st * ey + cp * ct * ez;

  return {
    x: 0.5 + R * sx,
    y: 0.5 - R * sy,
    visible: sz > 0,
    sz,
  };
}

/** The `phi` at which the given longitude faces the viewer. */
export function facingPhi(lng: number): number {
  return -(lng * Math.PI) / 180 - Math.PI / 2;
}

/** Signed shortest rotation from one angle to another, in (-PI, PI]. */
export function shortestRotation(from: number, to: number): number {
  const tau = Math.PI * 2;
  let delta = (to - from) % tau;
  if (delta > Math.PI) delta -= tau;
  if (delta <= -Math.PI) delta += tau;
  return delta;
}
