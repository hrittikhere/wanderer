// Pure color helpers for the globe tokens. The DOM-facing resolution lives in
// GlobeView; everything here is testable in plain Node.
import type { Rgb } from './renderer-types.js';

export type Rgba = [number, number, number, number];

/**
 * Parses the `rgb()` / `rgba()` serialization browsers use for sRGB computed
 * colors, including the alpha channel in comma and slash syntax. Any other
 * syntax (oklch, lab, color()) returns null and is resolved through a canvas.
 */
export function parseCssColor(value: string): Rgba | null {
  const match = /^\s*rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)\s*$/i.exec(value);
  if (!match) return null;
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
  const channel = (raw: string) => Math.min(1, Math.max(0, Number(raw) / 255));
  if (!Number.isFinite(alpha)) return null;
  return [channel(match[1]), channel(match[2]), channel(match[3]), Math.min(1, Math.max(0, alpha))];
}

/** Composites a translucent color over an opaque base, since the WebGL uniforms are opaque. */
export function compositeOver(color: Rgba, base: Rgb): Rgb {
  const alpha = color[3];
  return [
    color[0] * alpha + base[0] * (1 - alpha),
    color[1] * alpha + base[1] * (1 - alpha),
    color[2] * alpha + base[2] * (1 - alpha),
  ];
}

/** Reads a resolved color through a 1x1 2D canvas, which normalizes every CSS color syntax to sRGB. */
export function readCanvasColor(context: CanvasRenderingContext2D, value: string): Rgba | null {
  try {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    if (data.length < 4) return null;
    return [data[0] / 255, data[1] / 255, data[2] / 255, data[3] / 255];
  } catch {
    return null;
  }
}
