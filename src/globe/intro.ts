// The intro particle system: land is sketched as a grid of dots that light up
// outward from a handful of "clusters" (the busiest markers), then the dots
// settle and fade while the WebGL globe is revealed underneath. Everything
// here is pure apart from the random jitter, which the caller injects, so the
// scene can be built inside an effect and drawn from a frame loop.
import type { GlobeMarker } from '../types.js';
import type { Rgb } from './renderer-types.js';
import { clamp, projectMarker, smoothstep } from './projection.js';

export const INTRO_DURATION_MS = 2350;
export const INTRO_REVEAL_DELAY_MS = 1540;
export const INTRO_REVEAL_DURATION_MS = 920;
export const INTRO_PARTICLE_FADE_START_MS = 1860;
export const INTRO_PARTICLE_FADE_DURATION_MS = 640;
export const INTRO_SPIN_RATE = 0.00062;
/** Delay after the intro before milestone callouts and other scene details start. */
export const SCENE_DETAILS_DELAY_MS = 260;

export interface IntroCluster {
  lat: number;
  lng: number;
  startMs: number;
  radius: number;
  strength: number;
}

export interface IntroDot {
  lat: number;
  lng: number;
  size: number;
  seed: number;
  sourceIndex: number;
  sourceDistance: number;
  startMs: number;
  settleMs: number;
}

export interface IntroScene {
  clusters: IntroCluster[];
  dots: IntroDot[];
}

type GeoPolygon = Array<[number, number]>;

// Coarse continent outlines (longitude, latitude). Precision is irrelevant:
// the dots only need to read as land at a glance for two seconds.
const LAND_POLYGONS: GeoPolygon[] = [
  [
    [-168, 72], [-150, 70], [-132, 58], [-126, 49], [-124, 40], [-117, 32],
    [-111, 26], [-97, 18], [-83, 10], [-80, 8], [-78, 18], [-81, 26],
    [-80, 32], [-75, 38], [-66, 45], [-60, 52], [-63, 58], [-75, 64],
    [-95, 71], [-130, 73],
  ],
  [
    [-60, 60], [-44, 60], [-28, 68], [-20, 78], [-28, 84], [-46, 82],
    [-60, 74],
  ],
  [
    [-81, 12], [-74, 7], [-71, -6], [-74, -18], [-72, -35], [-66, -52],
    [-54, -56], [-46, -50], [-40, -30], [-35, -10], [-44, 4], [-58, 10],
    [-70, 12],
  ],
  [
    [-10, 36], [-2, 42], [10, 46], [24, 48], [36, 45], [44, 42], [38, 36],
    [26, 36], [18, 40], [8, 44], [-4, 44], [-10, 40],
  ],
  [
    [-18, 36], [-4, 36], [12, 34], [26, 31], [34, 24], [42, 12], [50, 4],
    [49, -12], [40, -24], [30, -34], [18, -35], [8, -34], [-2, -28],
    [-10, -18], [-16, -2], [-16, 14],
  ],
  [
    [34, 32], [42, 34], [50, 30], [56, 22], [56, 16], [50, 12], [42, 14],
    [36, 22],
  ],
  [
    [68, 24], [76, 31], [86, 28], [90, 21], [88, 10], [81, 7], [74, 9],
    [69, 18],
  ],
  [
    [26, 34], [44, 40], [64, 46], [90, 58], [118, 60], [142, 54], [156, 50],
    [162, 60], [168, 70], [178, 72], [178, 50], [162, 42], [142, 34],
    [124, 24], [110, 18], [98, 12], [84, 16], [70, 22], [54, 28], [40, 30],
    [30, 30],
  ],
  [
    [95, 22], [105, 20], [112, 16], [120, 14], [125, 8], [122, 2], [116, 0],
    [108, 3], [100, 8], [95, 15],
  ],
  [
    [95, 6], [108, 7], [118, 2], [132, -3], [142, -7], [150, -8], [154, -2],
    [145, 2], [132, 4], [118, 5], [104, 4], [96, 2],
  ],
  [
    [129, -11], [140, -10], [153, -18], [154, -32], [145, -40], [132, -38],
    [114, -28], [114, -18], [122, -12],
  ],
  [
    [165, -34], [174, -35], [178, -42], [173, -47], [166, -44], [164, -38],
  ],
  [
    [138, 34], [143, 40], [146, 45], [142, 42], [138, 38], [136, 35],
  ],
  [
    [47, -13], [51, -12], [50, -24], [45, -26], [43, -18],
  ],
];

function pointInPolygon(lng: number, lat: number, polygon: GeoPolygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function isLikelyLand(lat: number, lng: number): boolean {
  return LAND_POLYGONS.some((polygon) => pointInPolygon(lng, lat, polygon));
}

function normalizedLongitudeDelta(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/** Cheap angular distance in degrees; good enough for ordering and falloff. */
function approximateGeoDistance(latA: number, lngA: number, latB: number, lngB: number): number {
  const lngScale = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  const lngDelta = normalizedLongitudeDelta(lngA, lngB) * lngScale;
  const latDelta = latA - latB;
  return Math.hypot(latDelta, lngDelta);
}

/** Picks up to eight well separated, busy markers to seed the bloom. */
export function buildIntroClusters(markers: readonly GlobeMarker[]): IntroCluster[] {
  const pool = markers
    .map((marker) => ({ lat: marker.coordinates[0], lng: marker.coordinates[1], weight: marker.count }))
    .sort((a, b) => b.weight - a.weight);
  const selected: Array<{ lat: number; lng: number; weight: number }> = [];
  const targetCount = Math.min(8, pool.length);

  while (selected.length < targetCount && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const separation = selected.length
        ? Math.min(...selected.map((entry) => approximateGeoDistance(candidate.lat, candidate.lng, entry.lat, entry.lng)))
        : 180;
      const score = candidate.weight * 10 + separation;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    selected.push(pool.splice(bestIndex, 1)[0]);
  }

  return selected.map((cluster, index) => ({
    lat: cluster.lat,
    lng: cluster.lng,
    startMs: 260 + index * 170,
    radius: 22 + Math.min(cluster.weight, 6) * 2.6,
    strength: 0.8 + Math.min(cluster.weight, 6) * 0.07,
  }));
}

/** Lays a 4 degree grid of dots over land, each timed by its distance to the nearest cluster. */
export function buildIntroDots(clusters: readonly IntroCluster[], random: () => number = Math.random): IntroDot[] {
  if (clusters.length === 0) return [];
  const dots: IntroDot[] = [];
  for (let lat = -78; lat <= 78; lat += 4) {
    for (let lng = -180; lng < 180; lng += 4) {
      if (!isLikelyLand(lat, lng)) continue;
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        const distance = approximateGeoDistance(lat, lng, clusters[i].lat, clusters[i].lng);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }
      const source = clusters[nearestIndex];
      const jitter = random() * 36;
      const startMs = source.startMs + nearestDistance * 17 + jitter;
      dots.push({
        lat,
        lng,
        size: 0.5 + random() * 0.35,
        seed: random() * Math.PI * 2,
        sourceIndex: nearestIndex,
        sourceDistance: nearestDistance,
        startMs,
        settleMs: startMs + 150 + nearestDistance * 4,
      });
    }
  }
  return dots;
}

export function buildIntroScene(markers: readonly GlobeMarker[], random: () => number = Math.random): IntroScene {
  const clusters = buildIntroClusters(markers);
  return { clusters, dots: buildIntroDots(clusters, random) };
}

export interface IntroFrame {
  /** Milliseconds since the intro started. */
  elapsed: number;
  phi: number;
  width: number;
  height: number;
  /** Color of the settled land dots (the globe's land token). */
  neutral: Rgb;
  /** Color of the cluster bloom and the wave that ripples outward (the marker token). */
  bloom: Rgb;
}

function rgbaPrefix([r, g, b]: Rgb): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, `;
}

function fillCircle(context: CanvasRenderingContext2D, prefix: string, alpha: number, x: number, y: number, radius: number): void {
  context.fillStyle = `${prefix}${alpha})`;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

/** Draws one frame of the intro; the caller clears nothing, this does. */
export function drawIntroFrame(context: CanvasRenderingContext2D, scene: IntroScene, frame: IntroFrame): void {
  const { elapsed, phi, width, height } = frame;
  const neutral = rgbaPrefix(frame.neutral);
  const bloom = rgbaPrefix(frame.bloom);
  context.clearRect(0, 0, width, height);

  const particleFade = elapsed <= INTRO_PARTICLE_FADE_START_MS
    ? 1
    : 1 - smoothstep((elapsed - INTRO_PARTICLE_FADE_START_MS) / INTRO_PARTICLE_FADE_DURATION_MS) * 0.82;

  for (const cluster of scene.clusters) {
    const projection = projectMarker(cluster.lat, cluster.lng, phi);
    if (!projection.visible) continue;
    const rise = smoothstep((elapsed - (cluster.startMs - 220)) / 220);
    if (rise <= 0) continue;

    const x = projection.x * width;
    const y = projection.y * height;
    const depthBoost = 0.25 + projection.sz * 0.6;
    const pulse = 0.9 + 0.1 * Math.sin(elapsed / 90 + cluster.lat * 0.08 + cluster.lng * 0.03);
    const haloAlpha = particleFade * rise * depthBoost * cluster.strength * 0.16 * pulse;
    const coreAlpha = particleFade * rise * depthBoost * cluster.strength * 0.9;
    const haloRadius = (7 + cluster.strength * 3.5) * (0.55 + rise * 0.85);
    const coreRadius = (1.2 + cluster.strength * 0.55) * (0.7 + rise * 0.35);
    fillCircle(context, bloom, haloAlpha, x, y, haloRadius);
    fillCircle(context, bloom, coreAlpha, x, y, coreRadius);
  }

  for (const dot of scene.dots) {
    const projection = projectMarker(dot.lat, dot.lng, phi);
    if (!projection.visible) continue;
    const activation = smoothstep((elapsed - dot.startMs) / 200);
    if (activation <= 0) continue;

    const x = projection.x * width;
    const y = projection.y * height;
    const cluster = scene.clusters[dot.sourceIndex];
    const settle = smoothstep((elapsed - dot.settleMs) / 360);
    const wave = smoothstep((elapsed - dot.startMs) / 120) - smoothstep((elapsed - dot.startMs - 170) / 220);
    const layerWave = smoothstep((elapsed - dot.startMs - 75) / 160) - smoothstep((elapsed - dot.startMs - 240) / 260);
    const radialFalloff = clamp(1 - dot.sourceDistance / cluster.radius, 0.18, 1);
    const depthBoost = 0.24 + projection.sz * 0.58;
    const coreRadius = dot.size * (0.8 + projection.sz * 0.6 + settle * 0.34);
    const massRadius = coreRadius * (2.8 + radialFalloff * 1.2);
    const flicker = 0.94 + 0.06 * Math.sin(elapsed / 160 + dot.seed);

    if (settle > 0.02) {
      fillCircle(context, neutral, particleFade * settle * settle * radialFalloff * depthBoost * 0.09, x, y, massRadius);
    }
    fillCircle(context, neutral, particleFade * activation * depthBoost * (0.2 + 0.55 * settle) * flicker, x, y, coreRadius);

    const bloomWave = clamp((wave * 1.25 + layerWave * 0.8) * cluster.strength * radialFalloff, 0, 1.3);
    if (bloomWave > 0.02) {
      const alpha = particleFade * bloomWave * depthBoost * (1 - settle * 0.35);
      fillCircle(context, bloom, alpha * 0.16, x, y, coreRadius * (4 + bloomWave * 1.4));
      fillCircle(context, bloom, alpha * 0.72, x, y, coreRadius * (1.55 + bloomWave * 0.28));
    }
  }
}
