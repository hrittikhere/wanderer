'use client';

// The WebGL globe. Everything that touches the DOM or the clock lives in
// effects, handlers, and frame callbacks: the module evaluates in plain Node.
//
// Layers inside `.wanderer-globe__scene`, bottom to top:
//   1. the cobe canvas (drag to rotate, hover for tooltips),
//   2. the intro canvas (a 2D particle sketch that fades into the globe),
//   3. an SVG of dashed connectors from milestone dots to the callout anchor,
//   4. milestone dots on the globe surface,
//   5. the hover tooltip.
// Colors, rotation, sizes and the drawn markers change on the live cobe state
// inside onRender; the globe is created once per mount (and again only after
// a lost WebGL context is restored).
import cobeExport, { type COBEOptions } from 'cobe';
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { PinIcon } from '../components/icons.js';
import type { TextDirection } from '../component-types.js';
import { parseCalendarDate } from '../helpers.js';
import type { GlobeMarker } from '../types.js';
import { FrameLoop } from './frame-loop.js';
import {
  INTRO_DURATION_MS, INTRO_REVEAL_DELAY_MS, INTRO_REVEAL_DURATION_MS, INTRO_SPIN_RATE, SCENE_DETAILS_DELAY_MS,
  buildIntroScene, drawIntroFrame,
} from './intro.js';
import { cobeMarkers, drawnMarkers, markerSetKey } from './markers.js';
import { MilestoneTracker } from './milestones.js';
import { R, THETA, clamp, easeOutCubic, facingPhi, projectMarker, shortestRotation } from './projection.js';
import type { GlobeRendererProps } from './renderer-types.js';

// cobe is ESM-only. The CommonJS build binds this default import to the whole
// `require('cobe')` result, which is cobe's module namespace under Node's
// require(esm) and under bundlers, so the function sits one `default` deeper.
const createGlobe: typeof cobeExport = typeof cobeExport === 'function'
  ? cobeExport
  : (cobeExport as unknown as { default: typeof cobeExport }).default;

type GlobeState = Parameters<COBEOptions['onRender']>[0];
type GlobeInstance = ReturnType<typeof createGlobe>;
/** particles: only the sketch is visible; reveal: the globe fades in under it; fade: the sketch fades out; done: sketch removed. */
type IntroPhase = 'particles' | 'reveal' | 'fade' | 'done';

/** Idle rotation in radians per millisecond (0.001 rad per frame at 60 Hz), so the speed is the same at any refresh rate. */
const IDLE_SPIN_RATE = 0.00006;
/** A frame after a pause, a hidden tab or a long task advances time-based motion by at most this much. */
const MAX_FRAME_STEP_MS = 64;
const FOCUS_ROTATION_MS = 600;
const CONNECTOR_REVEAL_MS = 600;
/** Pointer pixels per radian while dragging. */
const DRAG_SENSITIVITY = 200;
/** Hover hit radius in stage fractions. */
const HOVER_RADIUS = 0.06;
/** Mirrors `inline-size: 16rem` of `.wanderer-globe__tooltip` in styles.css; the rendered width replaces it once measured. */
const TOOLTIP_WIDTH_REM = 16;
const TOOLTIP_OFFSET = 16;
const TOOLTIP_EDGE = 8;
const MAP_SAMPLES = 16000;

interface TooltipState {
  marker: GlobeMarker;
  x: number;
  y: number;
}

interface FocusAnimation {
  target: number;
  /** Captured on the first processed frame so the intro cannot leave it stale. */
  from: number | null;
  delta: number;
  startedAt: number;
}

/** Mutable per-mount scene state shared by effects, handlers, and frame callbacks. */
interface SceneState {
  phi: number;
  /** The pointer that owns the drag; other pointers neither restart nor end it. */
  dragPointerId: number | null;
  dragStartX: number | null;
  dragDelta: number;
  /** Timestamp of the previous globe frame, for time-based idle rotation. */
  lastFrameAt: number | null;
  lastInteractionAt: number;
  width: number;
  height: number;
  /** True while the intro loop owns `phi`. */
  introDriving: boolean;
  introLoop: FrameLoop | null;
  finishIntro: (() => void) | null;
  sceneReadyAt: number | null;
  focus: FocusAnimation | null;
  connectorRevealAt: number;
  /** The milestone whose dot is still tracked while it fades out. */
  fadingId: string | null;
  tracker: MilestoneTracker;
  /** A tooltip dismissed with Escape stays hidden until the pointer leaves its marker. */
  suppressedTooltipId: string | null;
}

function schemeSettings(scheme: 'light' | 'dark'): { dark: number; diffuse: number; mapBrightness: number } {
  return scheme === 'dark'
    ? { dark: 1, diffuse: 2, mapBrightness: 8 }
    : { dark: 0, diffuse: 3, mapBrightness: 12 };
}

function busiestMarker(markers: readonly GlobeMarker[]): GlobeMarker | undefined {
  let best: GlobeMarker | undefined;
  for (const marker of markers) if (!best || marker.count > best.count) best = marker;
  return best;
}

function devicePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** Root font size in pixels, for the rem-based widths the stylesheet uses. */
function rootFontSize(): number {
  return parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * Creates the globe and returns it with a release function. phenomenon (cobe's
 * renderer) adds a window resize listener it never removes, which would keep
 * every destroyed globe and its WebGL context reachable from `window`; the
 * listener is captured here so release() can remove it. Resizing is handled
 * by the ResizeObserver either way.
 */
function createReleasableGlobe(canvas: HTMLCanvasElement, options: COBEOptions): { globe: GlobeInstance; release: () => void } {
  const listeners: EventListenerOrEventListenerObject[] = [];
  const own = Object.getOwnPropertyDescriptor(window, 'addEventListener');
  const add = window.addEventListener;
  window.addEventListener = function capture(this: Window, type: string, listener: EventListenerOrEventListenerObject | null, ...rest: unknown[]) {
    if (type === 'resize' && listener) listeners.push(listener);
    return (add as (...args: unknown[]) => void).call(this, type, listener, ...rest);
  } as typeof window.addEventListener;
  let globe: GlobeInstance;
  try {
    globe = createGlobe(canvas, options);
  } finally {
    if (own) Object.defineProperty(window, 'addEventListener', own);
    else delete (window as unknown as { addEventListener?: unknown }).addEventListener;
  }
  return {
    globe,
    release: () => {
      for (const listener of listeners.splice(0)) window.removeEventListener('resize', listener);
      globe.destroy();
    },
  };
}

/** Milliseconds from a CSS time such as `920ms` or `1.5s`, or null. */
export function parseCssTime(value: string): number | null {
  const match = /^\s*(\d+\.?\d*|\.\d+)(ms|s)\s*$/i.exec(value);
  if (!match) return null;
  return Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1);
}

/** Percent anchors are mirrored for RTL, where the callout sits at `inset-inline-start`. */
function resolveAnchor(anchor: { x: string; y: string }, direction: TextDirection): { x: string; y: string } {
  const percent = /^\s*(-?[\d.]+)%\s*$/.exec(anchor.x);
  if (direction !== 'rtl' || !percent) return anchor;
  return { x: `${100 - Number(percent[1])}%`, y: anchor.y };
}

/** Pixel position of an anchor inside the stage, or null when it is not a percentage or pixel length. */
function anchorToPixels(value: string, extent: number): number | null {
  const match = /^\s*(-?[\d.]+)(%|px)?\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 'px' ? amount : (amount / 100) * extent;
}

function latestYear(marker: GlobeMarker, formatDate: GlobeRendererProps['formatDate']): string {
  const { date } = marker.latestTalk;
  return parseCalendarDate(date) ? formatDate(date, { year: 'numeric' }) : '';
}

export default function GlobeRenderer(props: GlobeRendererProps) {
  const {
    markers, milestones, reducedMotion, paused, intro, showConnectors, calloutAnchor, copy, direction,
    activeMilestoneId, focusMarkerId,
  } = props;

  const propsRef = useRef(props);
  propsRef.current = props;
  // cobe draws at most MAX_GLOBE_MARKERS; hover and the intro only use what is drawn.
  const drawn = useMemo(() => drawnMarkers(markers), [markers]);
  const drawnKey = useMemo(() => markerSetKey(drawn), [drawn]);
  const drawnRef = useRef({ markers: drawn, key: drawnKey });
  drawnRef.current = { markers: drawn, key: drawnKey };

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const introCanvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  /** Set while the globe is rebuilt on a restored context, so cleanup keeps that context. */
  const rebuildingRef = useRef(false);
  const dotRefs = useRef(new Map<string, HTMLDivElement>());
  const lineRefs = useRef(new Map<string, SVGLineElement>());

  // Decided once per mount: a later change to `intro` or reduced motion never replays it.
  const [playIntro] = useState(() => intro && !reducedMotion && markers.length > 0);
  const [introPhase, setIntroPhase] = useState<IntroPhase>(playIntro ? 'particles' : 'done');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [tooltipWidth, setTooltipWidth] = useState<number | null>(null);
  // Bumped when a lost WebGL context is restored, so the globe is rebuilt on the restored context.
  const [contextGeneration, setContextGeneration] = useState(0);

  const sceneRef = useRef<SceneState | null>(null);
  if (sceneRef.current === null) {
    // Start with the busiest location facing the viewer; the intro spin lands there.
    const top = busiestMarker(markers);
    const restingPhi = top ? facingPhi(top.coordinates[1]) : 0;
    sceneRef.current = {
      phi: restingPhi - (playIntro ? INTRO_DURATION_MS * INTRO_SPIN_RATE : 0),
      dragPointerId: null,
      dragStartX: null,
      dragDelta: 0,
      lastFrameAt: null,
      lastInteractionAt: 0,
      width: 0,
      height: 0,
      introDriving: playIntro,
      introLoop: null,
      finishIntro: null,
      sceneReadyAt: null,
      focus: null,
      connectorRevealAt: 0,
      fadingId: null,
      tracker: new MilestoneTracker(milestones),
      suppressedTooltipId: null,
    };
  }
  const scene = sceneRef.current;

  // Size: cached from ResizeObserver so onRender never reads layout.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    scene.width = root.clientWidth;
    scene.height = root.clientHeight;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      scene.width = entry.contentRect.width;
      scene.height = entry.contentRect.height;
      // Phenomenon only resizes its drawing buffer on window resize; layout changes need a nudge.
      globeRef.current?.resize();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [scene]);

  // The globe itself, created once per mount and again only on a restored
  // WebGL context. A changed marker set (search, filters) is handed to the
  // live globe in onRender instead of compiling a new one.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rebuildingRef.current = false;
    let dpr = devicePixelRatio();
    let alive = true;
    let globe: GlobeInstance | null = null;
    let appliedColors = propsRef.current.colors;
    let appliedScheme = propsRef.current.colorScheme;
    let appliedMarkersKey = drawnRef.current.key;

    const positionMilestone = (id: string, phi: number, now: number) => {
      const milestone = scene.tracker.find(id);
      const dot = dotRefs.current.get(id);
      const line = lineRefs.current.get(id);
      if (!milestone || (!dot && !line)) return;
      const projection = projectMarker(milestone.coordinates[0], milestone.coordinates[1], phi);
      const px = projection.x * scene.width;
      const py = projection.y * scene.height;
      const visibility = projection.visible ? '' : 'hidden';
      if (dot) {
        dot.style.left = `${px}px`;
        dot.style.top = `${py}px`;
        dot.style.visibility = visibility;
      }
      if (line) {
        let x1 = px;
        let y1 = py;
        const current = propsRef.current;
        if (!current.reducedMotion && scene.tracker.active === id) {
          const anchor = resolveAnchor(current.calloutAnchor, current.direction);
          const ax = anchorToPixels(anchor.x, scene.width);
          const ay = anchorToPixels(anchor.y, scene.height);
          if (ax !== null && ay !== null) {
            const progress = easeOutCubic((now - scene.connectorRevealAt) / CONNECTOR_REVEAL_MS);
            x1 = ax + (px - ax) * progress;
            y1 = ay + (py - ay) * progress;
          }
        }
        line.setAttribute('x1', `${x1}`);
        line.setAttribute('y1', `${y1}`);
        line.style.visibility = visibility;
      }
    };

    const updateMilestones = (phi: number, now: number) => {
      const current = propsRef.current;
      const change = current.autoMilestones === false ? {} : scene.tracker.update({
        phi,
        now,
        sceneReadyAt: scene.sceneReadyAt,
        interacting: scene.dragStartX !== null,
        lastInteractionAt: scene.lastInteractionAt,
      });
      if (change.dismissed !== undefined) {
        scene.fadingId = change.dismissed;
        current.onActiveMilestoneChange(null);
      }
      if (change.activated !== undefined) {
        scene.connectorRevealAt = now;
        scene.fadingId = null;
        current.onActiveMilestoneChange(change.activated);
      }
      const tracked = scene.tracker.active ?? scene.fadingId;
      if (tracked !== null) positionMilestone(tracked, phi, now);
    };

    const onRender = (state: GlobeState) => {
      // A frame queued before destroy() still fires once; it must not touch the scene.
      if (!alive) return;
      const now = performance.now();
      const step = scene.lastFrameAt === null ? 0 : clamp(now - scene.lastFrameAt, 0, MAX_FRAME_STEP_MS);
      scene.lastFrameAt = now;
      const current = propsRef.current;
      const { key, markers: nextMarkers } = drawnRef.current;
      if (key !== appliedMarkersKey) {
        appliedMarkersKey = key;
        state.markers = cobeMarkers(nextMarkers, true);
      }
      // Browser zoom and moving between displays change the ratio; phenomenon only reads it at creation.
      const ratio = devicePixelRatio();
      if (globe && ratio !== dpr) {
        dpr = ratio;
        globe.devicePixelRatio = ratio;
        globe.resize();
      }
      if (current.colors !== appliedColors || current.colorScheme !== appliedScheme) {
        appliedColors = current.colors;
        appliedScheme = current.colorScheme;
        const settings = schemeSettings(appliedScheme);
        state.dark = settings.dark;
        state.diffuse = settings.diffuse;
        state.mapBrightness = settings.mapBrightness;
        state.baseColor = appliedColors.land;
        state.glowColor = appliedColors.glow;
        state.markerColor = appliedColors.marker;
      }

      if (!scene.introDriving) {
        const focus = scene.focus;
        if (focus) {
          if (focus.from === null) {
            focus.from = scene.phi;
            focus.delta = shortestRotation(focus.from, focus.target);
            focus.startedAt = now;
          }
          const duration = current.reducedMotion ? 0 : FOCUS_ROTATION_MS;
          const progress = duration === 0 ? 1 : (now - focus.startedAt) / duration;
          scene.phi = focus.from + focus.delta * easeOutCubic(progress);
          if (progress >= 1) scene.focus = null;
        } else if (scene.dragStartX === null && current.autoRotate && !current.reducedMotion) {
          scene.phi += IDLE_SPIN_RATE * step;
        }
      }

      const phi = scene.phi + scene.dragDelta;
      state.phi = phi;
      const extent = scene.width * dpr;
      state.width = extent;
      state.height = extent;
      updateMilestones(phi, now);
    };

    const settings = schemeSettings(appliedScheme);
    const created = createReleasableGlobe(canvas, {
      devicePixelRatio: dpr,
      width: scene.width * dpr,
      height: scene.width * dpr,
      phi: scene.phi,
      theta: THETA,
      dark: settings.dark,
      diffuse: settings.diffuse,
      mapSamples: MAP_SAMPLES,
      mapBrightness: settings.mapBrightness,
      // cobe 0.6.5 declares this optional but uploads undefined as NaN when
      // omitted, turning the entire sphere black on real WebGL drivers.
      mapBaseBrightness: 0,
      baseColor: appliedColors.land,
      markerColor: appliedColors.marker,
      glowColor: appliedColors.glow,
      markers: cobeMarkers(drawnRef.current.markers),
      onRender,
    });
    const createdGlobe = created.globe;
    globe = createdGlobe;
    globeRef.current = createdGlobe;
    const gl = createdGlobe.gl as WebGLRenderingContext | null;
    if (propsRef.current.paused) createdGlobe.toggle(false);

    // Context loss (GPU reset, backgrounding, the per-page context cap):
    // preventDefault asks the browser to restore the context, and the restore
    // event rebuilds the globe. Until then rendering stops.
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      createdGlobe.toggle(false);
      propsRef.current.onContextLost?.();
    };
    const handleContextRestored = () => {
      propsRef.current.onContextRestored?.();
      rebuildingRef.current = true;
      setContextGeneration((generation) => generation + 1);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    return () => {
      alive = false;
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      created.release();
      globeRef.current = null;
      scene.lastFrameAt = null;
      // Unmounting releases the context right away instead of waiting for
      // garbage collection: browsers cap live contexts per page. React removes
      // an unmounted canvas from the document before this cleanup runs; a
      // canvas still in the document is about to be reused (StrictMode's
      // effect replay, a hidden <Activity>, a rebuild on a restored context)
      // and keeps its context.
      if (!rebuildingRef.current && !canvas.isConnected) {
        try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already lost */ }
      }
    };
  }, [contextGeneration, scene]);

  // Intro: the particle sketch drives `phi` until it hands over to the globe.
  // Its phases follow the time the loop has actually rendered, not the wall
  // clock, so a globe mounted in a hidden tab or below the fold plays the
  // intro once it is visible and still lands on the busiest location.
  useEffect(() => {
    if (!playIntro) {
      scene.introDriving = false;
      scene.sceneReadyAt = performance.now();
      return;
    }
    const canvas = introCanvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    const startPhi = scene.phi;
    const landingPhi = startPhi + INTRO_DURATION_MS * INTRO_SPIN_RATE;
    let phase: IntroPhase = 'particles';
    const finish = () => {
      scene.introLoop?.cancel();
      scene.introLoop = null;
      scene.finishIntro = null;
      // An intro cut short (reduced motion, no 2D context) still lands where it would have.
      if (scene.introDriving) scene.phi = landingPhi;
      scene.introDriving = false;
      if (scene.sceneReadyAt === null) scene.sceneReadyAt = performance.now();
      setIntroPhase('done');
    };
    if (!canvas || !context) {
      finish();
      return;
    }

    // The sketch is removed once the CSS cross-fade, which reads this token, has finished.
    const root = rootRef.current;
    const token = root ? window.getComputedStyle(root).getPropertyValue('--wanderer-globe-reveal-duration') : '';
    const revealDuration = parseCssTime(token) ?? INTRO_REVEAL_DURATION_MS;
    const introScene = buildIntroScene(drawnRef.current.markers);
    let elapsed = 0;
    let lastNow: number | null = null;
    const loop = new FrameLoop((now) => {
      elapsed += lastNow === null ? 0 : clamp(now - lastNow, 0, MAX_FRAME_STEP_MS);
      lastNow = now;
      if (phase === 'particles' && elapsed >= INTRO_REVEAL_DELAY_MS) {
        phase = 'reveal';
        setIntroPhase('reveal');
      }
      if (phase === 'reveal' && elapsed >= INTRO_DURATION_MS) {
        phase = 'fade';
        scene.phi = landingPhi;
        scene.introDriving = false;
        scene.sceneReadyAt = performance.now() + SCENE_DETAILS_DELAY_MS;
        setIntroPhase('fade');
      }
      if (phase === 'fade' && elapsed >= INTRO_DURATION_MS + revealDuration) {
        finish();
        return;
      }
      const phi = Math.min(startPhi + elapsed * INTRO_SPIN_RATE, landingPhi);
      if (scene.introDriving) scene.phi = phi;
      const { width, height } = scene;
      if (width > 0 && height > 0 && elapsed < INTRO_DURATION_MS + 100) {
        const dpr = devicePixelRatio();
        const bufferWidth = Math.round(width * dpr);
        const bufferHeight = Math.round(height * dpr);
        if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
          canvas.width = bufferWidth;
          canvas.height = bufferHeight;
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        const { colors } = propsRef.current;
        drawIntroFrame(context, introScene, { elapsed, phi, width, height, neutral: colors.land, bloom: colors.marker });
      }
      loop.request();
    });
    scene.introLoop = loop;
    scene.finishIntro = finish;
    scene.introDriving = true;
    if (propsRef.current.paused) loop.pause();
    loop.request();

    return () => {
      loop.cancel();
      scene.introLoop = null;
      scene.finishIntro = null;
      scene.introDriving = false;
    };
  }, [playIntro, scene]);

  // A reduced-motion preference arriving mid-intro ends it immediately.
  useEffect(() => {
    if (reducedMotion) scene.finishIntro?.();
  }, [reducedMotion, scene]);

  // Pause: no frames while hidden or offscreen.
  useEffect(() => {
    if (paused) {
      globeRef.current?.toggle(false);
      scene.introLoop?.pause();
      setTooltip(null);
      return;
    }
    scene.introLoop?.resume();
    // Phenomenon's toggle(true) renders synchronously and queues its own next
    // frame, while the frame queued before toggle(false) stays queued (frozen
    // while the tab is hidden). Resuming on the next frame lets that stale
    // callback run and stop first, so exactly one render chain survives.
    const frame = requestAnimationFrame(() => { globeRef.current?.toggle(true); });
    return () => cancelAnimationFrame(frame);
  }, [paused, scene]);

  // Milestones: keep the tracker in step with the data and the controlled active id.
  useEffect(() => {
    const previous = scene.tracker.active;
    scene.tracker.setMilestones(milestones);
    scene.tracker.setActive(activeMilestoneId, performance.now());
    if (scene.tracker.active !== previous) {
      scene.connectorRevealAt = performance.now();
      scene.fadingId = previous;
    }
    if (activeMilestoneId !== null && scene.tracker.active === null) {
      propsRef.current.onActiveMilestoneChange(null);
    }
  }, [milestones, activeMilestoneId, scene]);

  // Focus: turn the expanded location toward the viewer, then resume idling.
  // Only a change of the selected id triggers it; a new markers array (every
  // search keystroke) must not snap the globe back after the user dragged away.
  useEffect(() => {
    if (focusMarkerId === null) return;
    const marker = propsRef.current.markers.find((candidate) => candidate.id === focusMarkerId);
    if (!marker) return;
    scene.focus = { target: facingPhi(marker.coordinates[1]), from: null, delta: 0, startedAt: 0 };
  }, [focusMarkerId, scene]);

  // Stop everything on unmount, whatever state the effects above left behind.
  useEffect(() => () => {
    scene.introLoop?.cancel();
    scene.introLoop = null;
    scene.focus = null;
  }, [scene]);

  const hideTooltip = () => setTooltip((current) => (current === null ? current : null));

  // WCAG 1.4.13: Escape dismisses the tooltip without moving the pointer. The
  // event is consumed so it does not also switch views or close a dialog.
  const tooltipShown = tooltip !== null;
  useEffect(() => {
    if (!tooltipShown) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setTooltip((current) => {
        if (current) scene.suppressedTooltipId = current.marker.id;
        return null;
      });
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [tooltipShown, scene]);

  // The stylesheet sizes the tooltip in rem and consumers may restyle it; position it by its rendered width.
  useLayoutEffect(() => {
    const width = tooltipRef.current?.offsetWidth;
    if (tooltip && width && width !== tooltipWidth) setTooltipWidth(width);
  }, [tooltip, tooltipWidth]);

  const finishDrag = () => {
    if (scene.dragStartX === null) return;
    scene.phi += scene.dragDelta;
    scene.dragDelta = 0;
    scene.dragStartX = null;
    scene.dragPointerId = null;
    scene.lastInteractionAt = performance.now();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // A second finger neither restarts the drag nor discards the first one's rotation.
    if (scene.dragPointerId !== null) return;
    scene.dragPointerId = event.pointerId;
    scene.dragStartX = event.clientX;
    scene.dragDelta = 0;
    scene.focus = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    hideTooltip();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scene.dragPointerId !== null) {
      if (event.pointerId === scene.dragPointerId && scene.dragStartX !== null) {
        scene.dragDelta = (event.clientX - scene.dragStartX) / DRAG_SENSITIVITY;
      }
      return;
    }
    // The tooltip is hoverable: moving onto it keeps it open (it lets pointer events through to the canvas).
    const shown = tooltipRef.current?.getBoundingClientRect();
    if (shown && shown.width > 0 && event.clientX >= shown.left && event.clientX <= shown.right
      && event.clientY >= shown.top && event.clientY <= shown.bottom) return;
    const { width, height } = scene;
    if (width <= 0 || height <= 0) return;
    const x = event.nativeEvent.offsetX;
    const y = event.nativeEvent.offsetY;
    const nx = x / width;
    const ny = y / height;
    if (Math.hypot(nx - 0.5, ny - 0.5) > R) {
      scene.suppressedTooltipId = null;
      hideTooltip();
      return;
    }
    const phi = scene.phi + scene.dragDelta;
    let nearest: GlobeMarker | null = null;
    let nearestDistance = HOVER_RADIUS;
    for (const marker of drawnRef.current.markers) {
      const projection = projectMarker(marker.coordinates[0], marker.coordinates[1], phi);
      if (!projection.visible) continue;
      const distance = Math.hypot(nx - projection.x, ny - projection.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = marker;
      }
    }
    if (nearest?.id !== scene.suppressedTooltipId) scene.suppressedTooltipId = null;
    if (nearest && scene.suppressedTooltipId === null) setTooltip({ marker: nearest, x, y });
    else hideTooltip();
  };

  const releasePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    releasePointer(event);
    if (event.pointerId === scene.dragPointerId) finishDrag();
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    releasePointer(event);
    if (event.pointerId === scene.dragPointerId) finishDrag();
    hideTooltip();
  };

  const anchor = resolveAnchor(calloutAnchor, direction);

  let tooltipNode: ReactNode = null;
  if (tooltip) {
    const { marker } = tooltip;
    const width = Math.min(tooltipWidth ?? TOOLTIP_WIDTH_REM * rootFontSize(), Math.max(0, scene.width - TOOLTIP_EDGE * 2));
    const fitsEnd = tooltip.x + TOOLTIP_OFFSET + width <= scene.width - TOOLTIP_EDGE;
    const left = clamp(
      fitsEnd ? tooltip.x + TOOLTIP_OFFSET : tooltip.x - TOOLTIP_OFFSET - width,
      TOOLTIP_EDGE,
      Math.max(TOOLTIP_EDGE, scene.width - width - TOOLTIP_EDGE),
    );
    const above = tooltip.y > scene.height * 0.4;
    const style: CSSProperties = { left, top: above ? tooltip.y - TOOLTIP_OFFSET : tooltip.y + TOOLTIP_OFFSET };
    const year = latestYear(marker, props.formatDate);
    tooltipNode = (
      <div
        ref={tooltipRef}
        className="wanderer-globe__tooltip"
        aria-hidden="true"
        data-wanderer-tooltip-position={above ? 'above' : 'below'}
        style={style}
      >
        <div className="wanderer-globe__tooltip-header">
          <PinIcon className="wanderer-globe__tooltip-icon" />
          <span>{marker.label || copy.unknownLocation}</span>
        </div>
        <div className="wanderer-globe__tooltip-stats">
          <div>
            <span className="wanderer-globe__tooltip-value">{copy.locationCount(marker.count)}</span>
          </div>
          {year && (
            <div>
              <span className="wanderer-globe__tooltip-label">{copy.latest}</span>
              <span className="wanderer-globe__tooltip-value">{year}</span>
            </div>
          )}
        </div>
        <div className="wanderer-globe__tooltip-footer">{marker.latestTalk.event}</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="wanderer-globe__scene" data-wanderer-intro={introPhase}>
      <canvas
        ref={canvasRef}
        className="wanderer-globe__canvas"
        aria-hidden="true"
        data-wanderer-paused={paused ? 'true' : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={hideTooltip}
      />
      {introPhase !== 'done' && (
        <canvas ref={introCanvasRef} className="wanderer-globe__layer wanderer-globe__intro" aria-hidden="true" />
      )}
      {showConnectors && milestones.length > 0 && (
        <svg className="wanderer-globe__layer wanderer-globe__connectors" aria-hidden="true" focusable="false">
          {milestones.map((milestone) => (
            <line
              key={milestone.id}
              ref={(element) => {
                if (element) lineRefs.current.set(milestone.id, element);
                else lineRefs.current.delete(milestone.id);
              }}
              className="wanderer-globe__connector"
              x2={anchor.x}
              y2={anchor.y}
              data-wanderer-active={activeMilestoneId === milestone.id ? 'true' : undefined}
            />
          ))}
        </svg>
      )}
      {milestones.map((milestone) => (
        <div
          key={milestone.id}
          ref={(element) => {
            if (element) dotRefs.current.set(milestone.id, element);
            else dotRefs.current.delete(milestone.id);
          }}
          className="wanderer-globe__milestone-dot"
          aria-hidden="true"
          data-wanderer-milestone={milestone.id}
          data-wanderer-active={activeMilestoneId === milestone.id ? 'true' : undefined}
        />
      ))}
      {tooltipNode}
    </div>
  );
}
