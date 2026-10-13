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
// Colors, rotation, and sizes change on the live cobe state inside onRender;
// the globe is only recreated when the marker set changes.
import createGlobe, { type COBEOptions } from 'cobe';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { PinIcon } from '../components/icons.js';
import type { TextDirection } from '../component-types.js';
import { parseCalendarDate } from '../helpers.js';
import type { GlobeMarker } from '../types.js';
import { FrameLoop } from './frame-loop.js';
import {
  INTRO_DURATION_MS, INTRO_REVEAL_DELAY_MS, INTRO_REVEAL_DURATION_MS, INTRO_SPIN_RATE, SCENE_DETAILS_DELAY_MS,
  buildIntroScene, drawIntroFrame,
} from './intro.js';
import { markerSetKey, markerSize } from './markers.js';
import { MilestoneTracker } from './milestones.js';
import { R, THETA, clamp, easeOutCubic, facingPhi, projectMarker, shortestRotation } from './projection.js';
import type { GlobeRendererProps } from './renderer-types.js';

type GlobeState = Parameters<COBEOptions['onRender']>[0];
type GlobeInstance = ReturnType<typeof createGlobe>;
/** particles: only the sketch is visible; reveal: the globe fades in under it; fade: the sketch fades out; done: sketch removed. */
type IntroPhase = 'particles' | 'reveal' | 'fade' | 'done';

const IDLE_SPIN_STEP = 0.001;
const FOCUS_ROTATION_MS = 600;
const CONNECTOR_REVEAL_MS = 600;
/** Pointer pixels per radian while dragging. */
const DRAG_SENSITIVITY = 200;
/** Hover hit radius in stage fractions. */
const HOVER_RADIUS = 0.06;
/** Mirrors `inline-size` of `.wanderer-globe__tooltip` in styles.css. */
const TOOLTIP_WIDTH = 256;
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
  dragStartX: number | null;
  dragDelta: number;
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

function latestYear(marker: GlobeMarker): string {
  const year = parseCalendarDate(marker.latestTalk.date)?.getUTCFullYear();
  return year === undefined ? '' : String(year);
}

export default function GlobeRenderer(props: GlobeRendererProps) {
  const {
    markers, milestones, reducedMotion, paused, intro, showConnectors, calloutAnchor, copy, direction,
    activeMilestoneId, focusMarkerId, renderMarkerTooltip,
  } = props;

  const propsRef = useRef(props);
  propsRef.current = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const introCanvasRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const dotRefs = useRef(new Map<string, HTMLDivElement>());
  const lineRefs = useRef(new Map<string, SVGLineElement>());

  // Decided once per mount: a later change to `intro` or reduced motion never replays it.
  const [playIntro] = useState(() => intro && !reducedMotion && markers.length > 0);
  const [introPhase, setIntroPhase] = useState<IntroPhase>(playIntro ? 'particles' : 'done');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Bumped when a lost WebGL context is restored, so the globe is rebuilt on the restored context.
  const [contextGeneration, setContextGeneration] = useState(0);
  const markersKey = markerSetKey(markers);

  const sceneRef = useRef<SceneState | null>(null);
  if (sceneRef.current === null) {
    // Start with the busiest location facing the viewer; the intro spin lands there.
    const top = busiestMarker(markers);
    const restingPhi = top ? facingPhi(top.coordinates[1]) : 0;
    sceneRef.current = {
      phi: restingPhi - (playIntro ? INTRO_DURATION_MS * INTRO_SPIN_RATE : 0),
      dragStartX: null,
      dragDelta: 0,
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

  // The globe itself. Recreated only when the drawn marker set changes (by
  // key, not array identity: every search keystroke produces a new array) or
  // after the WebGL context is restored.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = devicePixelRatio();
    let alive = true;
    let appliedColors = propsRef.current.colors;
    let appliedScheme = propsRef.current.colorScheme;

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
      const change = scene.tracker.update({
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
      const current = propsRef.current;
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
          scene.phi += IDLE_SPIN_STEP;
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
    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: scene.width * dpr,
      height: scene.width * dpr,
      phi: scene.phi,
      theta: THETA,
      dark: settings.dark,
      diffuse: settings.diffuse,
      mapSamples: MAP_SAMPLES,
      mapBrightness: settings.mapBrightness,
      baseColor: appliedColors.land,
      markerColor: appliedColors.marker,
      glowColor: appliedColors.glow,
      markers: propsRef.current.markers.map((marker) => ({
        location: [marker.coordinates[0], marker.coordinates[1]],
        size: markerSize(marker.count),
      })),
      onRender,
    });
    globeRef.current = globe;
    if (propsRef.current.paused) globe.toggle(false);

    // Context loss (GPU reset, backgrounding, the per-page context cap):
    // preventDefault asks the browser to restore the context, and the restore
    // event rebuilds the globe. Until then rendering stops.
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      globe.toggle(false);
      propsRef.current.onContextLost?.();
    };
    const handleContextRestored = () => {
      propsRef.current.onContextRestored?.();
      setContextGeneration((generation) => generation + 1);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    return () => {
      alive = false;
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      globe.destroy();
      globeRef.current = null;
    };
  }, [markersKey, contextGeneration, scene]);

  // Intro: the particle sketch drives `phi` until it hands over to the globe.
  useEffect(() => {
    if (!playIntro) {
      scene.introDriving = false;
      scene.sceneReadyAt = performance.now();
      return;
    }
    const canvas = introCanvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    const timers: number[] = [];
    const finish = () => {
      scene.introLoop?.cancel();
      scene.introLoop = null;
      scene.finishIntro = null;
      for (const timer of timers) window.clearTimeout(timer);
      timers.length = 0;
      scene.introDriving = false;
      if (scene.sceneReadyAt === null) scene.sceneReadyAt = performance.now();
      setIntroPhase('done');
    };
    if (!canvas || !context) {
      finish();
      return;
    }

    const introScene = buildIntroScene(propsRef.current.markers);
    const dpr = devicePixelRatio();
    const startPhi = scene.phi;
    let startedAt: number | null = null;
    const loop = new FrameLoop((now) => {
      if (startedAt === null) startedAt = now;
      const elapsed = now - startedAt;
      const phi = startPhi + elapsed * INTRO_SPIN_RATE;
      if (scene.introDriving) scene.phi = phi;
      const { width, height } = scene;
      if (width > 0 && height > 0) {
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
      if (elapsed < INTRO_DURATION_MS + 100) loop.request();
    });
    scene.introLoop = loop;
    scene.finishIntro = finish;
    scene.introDriving = true;
    if (propsRef.current.paused) loop.pause();
    loop.request();

    timers.push(window.setTimeout(() => setIntroPhase('reveal'), INTRO_REVEAL_DELAY_MS));
    timers.push(window.setTimeout(() => {
      scene.introDriving = false;
      scene.sceneReadyAt = performance.now() + SCENE_DETAILS_DELAY_MS;
      setIntroPhase('fade');
    }, INTRO_DURATION_MS));
    timers.push(window.setTimeout(finish, INTRO_DURATION_MS + INTRO_REVEAL_DURATION_MS));

    return () => {
      loop.cancel();
      scene.introLoop = null;
      scene.finishIntro = null;
      for (const timer of timers) window.clearTimeout(timer);
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

  const finishDrag = () => {
    if (scene.dragStartX === null) return;
    scene.phi += scene.dragDelta;
    scene.dragDelta = 0;
    scene.dragStartX = null;
    scene.lastInteractionAt = performance.now();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    scene.dragStartX = event.clientX;
    scene.dragDelta = 0;
    scene.focus = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    hideTooltip();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scene.dragStartX !== null) {
      scene.dragDelta = (event.clientX - scene.dragStartX) / DRAG_SENSITIVITY;
      return;
    }
    const { width, height } = scene;
    if (width <= 0 || height <= 0) return;
    const x = event.nativeEvent.offsetX;
    const y = event.nativeEvent.offsetY;
    const nx = x / width;
    const ny = y / height;
    if (Math.hypot(nx - 0.5, ny - 0.5) > R) {
      hideTooltip();
      return;
    }
    const phi = scene.phi + scene.dragDelta;
    let nearest: GlobeMarker | null = null;
    let nearestDistance = HOVER_RADIUS;
    for (const marker of propsRef.current.markers) {
      const projection = projectMarker(marker.coordinates[0], marker.coordinates[1], phi);
      if (!projection.visible) continue;
      const distance = Math.hypot(nx - projection.x, ny - projection.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = marker;
      }
    }
    if (nearest) setTooltip({ marker: nearest, x, y });
    else hideTooltip();
  };

  const releasePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    releasePointer(event);
    finishDrag();
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    releasePointer(event);
    finishDrag();
    hideTooltip();
  };

  const anchor = resolveAnchor(calloutAnchor, direction);

  let tooltipNode: ReactNode = null;
  if (tooltip) {
    const { marker } = tooltip;
    const width = Math.min(TOOLTIP_WIDTH, Math.max(0, scene.width - TOOLTIP_EDGE * 2));
    const fitsEnd = tooltip.x + TOOLTIP_OFFSET + width <= scene.width - TOOLTIP_EDGE;
    const left = clamp(
      fitsEnd ? tooltip.x + TOOLTIP_OFFSET : tooltip.x - TOOLTIP_OFFSET - width,
      TOOLTIP_EDGE,
      Math.max(TOOLTIP_EDGE, scene.width - width - TOOLTIP_EDGE),
    );
    const above = tooltip.y > scene.height * 0.4;
    const style: CSSProperties = { left, top: above ? tooltip.y - TOOLTIP_OFFSET : tooltip.y + TOOLTIP_OFFSET };
    const year = latestYear(marker);
    tooltipNode = (
      <div
        className="wanderer-globe__tooltip"
        aria-hidden="true"
        data-wanderer-tooltip-position={above ? 'above' : 'below'}
        style={style}
      >
        {renderMarkerTooltip ? renderMarkerTooltip(marker) : (
          <>
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
          </>
        )}
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
