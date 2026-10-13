'use client';

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type ComponentType, type ReactNode, type RefObject,
} from 'react';
import type { GlobeAsideProps, TalkViewProps, TalksContext, ViewContribution } from '../component-types.js';
import type { Geography, GlobeMarker, Talk } from '../types.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { Heading } from '../components/Heading.js';
import { GlobeIcon } from '../components/icons.js';
import { EmptyState } from '../components/ListView.js';
import { compareIds, parseCalendarDate, resolveTalkCoordinates, safeUrl } from '../helpers.js';
import { useIsClient, usePrefersReducedMotion } from '../hooks.js';
import { compositeOver, parseCssColor, readCanvasColor, type Rgba } from './colors.js';
import type { GlobeColors, GlobeRendererProps, PositionedMilestone, Rgb } from './renderer-types.js';

type RendererModule = { default: ComponentType<GlobeRendererProps> };
type GlobeStatus = 'idle' | 'loading' | 'ready' | 'error';
type GlobeErrorKind = 'module' | 'webgl' | 'runtime';

// A memoized import promise is a cache, not a registry: nothing is loaded until
// a globe view mounts or a consumer calls preloadGlobeView().
let rendererPromise: Promise<RendererModule> | null = null;
function loadRenderer(): Promise<RendererModule> {
  if (!rendererPromise) {
    rendererPromise = import('./renderer.js').then((module: RendererModule | { default: RendererModule }) => {
      // Under plain Node CommonJS, import() of a CJS module nests the exports object under `default`.
      const nested = (module as { default: RendererModule | ComponentType<GlobeRendererProps> }).default;
      const component = typeof nested === 'function' ? nested : nested.default;
      return { default: component };
    }).catch((error: unknown) => {
      rendererPromise = null;
      throw error;
    });
  }
  return rendererPromise;
}

/** Starts fetching the globe renderer and its `cobe` dependency. No-op on the server. */
export function preloadGlobeView(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return loadRenderer().then(() => undefined);
}

/** Probes WebGL support, then releases the probe context: browsers cap live contexts per page. */
function hasWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!context) return false;
    const gl = context as Partial<WebGLRenderingContext>;
    const lose = typeof gl.getExtension === 'function' ? gl.getExtension('WEBGL_lose_context') : null;
    if (lose && typeof lose.loseContext === 'function') lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** How long a lost WebGL context may take to come back before the globe gives way to the fallback. */
const CONTEXT_RESTORE_GRACE_MS = 2000;
/** Mirrors `inline-size: 13rem` of `.wanderer-globe__callout` beside the stage in styles.css. */
const CALLOUT_WIDTH_REM = 13;
/** Mirrors `inset-inline-start: 104%` of the same rule. */
const CALLOUT_STAGE_OFFSET = 0.04;
const CALLOUT_CLEARANCE_PX = 8;

const DEFAULT_COLORS: Record<'light' | 'dark', GlobeColors> = {
  light: { land: [0.17, 0.17, 0.2], marker: [0.15, 0.39, 0.92], background: [1, 1, 1], glow: [1, 1, 1] },
  dark: { land: [0.83, 0.83, 0.85], marker: [0.38, 0.65, 0.98], background: [0.04, 0.04, 0.04], glow: [0.1, 0.1, 0.1] },
};

/**
 * Reads the globe tokens from computed style so CSS overrides and per-instance
 * tokens reach WebGL. Any syntax the browser resolves works: sRGB values come
 * back as rgb()/rgba() and are parsed directly; oklch, lab, and color() values
 * are normalized through a 1x1 canvas. Alpha is composited over the background.
 */
function useGlobeColors(ref: RefObject<HTMLElement | null>, scheme: 'light' | 'dark', theme: string): GlobeColors {
  const [colors, setColors] = useState<GlobeColors>(DEFAULT_COLORS[scheme]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const computed = window.getComputedStyle(element);
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    element.appendChild(probe);
    let canvasContext: CanvasRenderingContext2D | null | undefined;
    const resolve = (token: string): Rgba | null => {
      const raw = computed.getPropertyValue(token).trim();
      if (!raw) return null;
      probe.style.color = '';
      probe.style.color = raw;
      // An invalid value leaves the declaration empty; the inherited color must not stand in for it.
      if (!probe.style.color) return null;
      const resolved = window.getComputedStyle(probe).color;
      const parsed = parseCssColor(resolved);
      if (parsed) return parsed;
      if (canvasContext === undefined) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvasContext = canvas.getContext('2d', { willReadFrequently: true });
      }
      return canvasContext ? readCanvasColor(canvasContext, resolved) : null;
    };
    const defaults = DEFAULT_COLORS[scheme];
    const background = compositeOver(resolve('--wanderer-globe-bg') ?? [...defaults.background, 1], defaults.background);
    const over = (token: string, fallback: Rgb): Rgb => {
      const color = resolve(token);
      return color ? compositeOver(color, background) : fallback;
    };
    setColors({
      land: over('--wanderer-globe-land', defaults.land),
      marker: over('--wanderer-globe-marker', defaults.marker),
      background,
      glow: over('--wanderer-globe-glow', defaults.glow),
    });
    probe.remove();
  }, [ref, scheme, theme]);
  return colors;
}

/**
 * Whether the milestone callout fits beside the stage. The stylesheet places
 * it at 104% of the stage with a fixed width, so this measures the free space
 * on the inline-end side of the stage inside its column; otherwise the callout
 * sits below the stage and no connectors are drawn. Undefined until measured.
 */
function useCalloutPlacement(stageRef: RefObject<HTMLElement | null>, direction: 'ltr' | 'rtl'): 'beside' | 'below' | undefined {
  const [beside, setBeside] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const stage = stageRef.current;
    const column = stage?.parentElement;
    if (!stage || !column) return;
    const measure = () => {
      const stageRect = stage.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const free = direction === 'rtl' ? stageRect.left - columnRect.left : columnRect.right - stageRect.right;
      const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const needed = stageRect.width * CALLOUT_STAGE_OFFSET + CALLOUT_WIDTH_REM * rem + CALLOUT_CLEARANCE_PX;
      setBeside(stageRect.width > 0 && free >= needed);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef, direction]);
  return beside === undefined ? undefined : beside ? 'beside' : 'below';
}

/** Talk ids are free-form strings; element ids and IDREF lists must not contain whitespace. */
function toDomId(id: string): string {
  return encodeURIComponent(id);
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'),
    () => true,
  );
}

function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

export interface GlobeViewOptions {
  /** `inline` sits in page flow; `immersive` opens a fullscreen dialog including navigation. */
  presentation?: 'inline' | 'immersive';
  /** Play the particle intro on first mount (skipped under reduced motion). Default true. */
  intro?: boolean;
  /** Rotate slowly while idle (disabled under reduced motion). Default true. */
  autoRotate?: boolean;
  label?: string;
  heading?: string;
  order?: number;
}

function sortMarkers(markers: readonly GlobeMarker[]): GlobeMarker[] {
  return [...markers].sort((a, b) => b.count - a.count || compareIds(a.id, b.id));
}

function latestYear(marker: GlobeMarker, formatDate: TalksContext['formatDate']): string {
  const { date } = marker.latestTalk;
  return parseCalendarDate(date) ? formatDate(date, { year: 'numeric' }) : '';
}

/** Keyboard-accessible equivalent of the canvas: regions, locations, and the talks at each location. */
export function GlobeRegionList({
  context, geography, expanded, onToggle,
}: GlobeAsideProps & { expanded?: string | null; onToggle?: (id: string | null) => void }) {
  const { copy, headingLevel } = context;
  const [localExpanded, setLocalExpanded] = useState<string | null>(null);
  const current = expanded === undefined ? localExpanded : expanded;
  const toggle = (id: string) => {
    const next = current === id ? null : id;
    setLocalExpanded(next);
    onToggle?.(next);
  };
  const markers = useMemo(() => sortMarkers(geography.markers), [geography.markers]);
  const baseId = `${context.instanceId}-globe`;
  return (
    <div className="wanderer-globe__lists">
      {geography.regions.length > 0 && (
        <section className="wanderer-globe__section" aria-labelledby={`${baseId}-regions`}>
          <Heading level={headingLevel + 1} id={`${baseId}-regions`} className="wanderer-globe__section-title">{copy.regions}</Heading>
          <ul className="wanderer-globe__regions">
            {[...geography.regions].sort((a, b) => b.count - a.count || compareIds(a.id, b.id)).map((region) => (
              <li key={region.id} className="wanderer-globe__region">
                <span className="wanderer-globe__region-name">{region.id}</span>
                <span className="wanderer-globe__region-value">{copy.regionPercentage(region.percentage)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="wanderer-globe__section" aria-labelledby={`${baseId}-locations`}>
        <Heading level={headingLevel + 1} id={`${baseId}-locations`} className="wanderer-globe__section-title">{copy.locations}</Heading>
        {markers.length === 0 ? (
          <p className="wanderer-globe__section-empty">{copy.noMappedTalks}</p>
        ) : (
          <ul className="wanderer-globe__locations">
            {markers.map((marker) => {
              const panelId = `${baseId}-location-${toDomId(marker.id)}`;
              const open = current === marker.id;
              const share = geography.mappedCount ? (marker.count / geography.mappedCount) * 100 : 0;
              return (
                <li key={marker.id} className="wanderer-globe__location" data-wanderer-expanded={open ? 'true' : undefined}>
                  <button
                    type="button"
                    className="wanderer-globe__location-button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggle(marker.id)}
                  >
                    <span className="wanderer-globe__location-dot" aria-hidden="true" />
                    <span className="wanderer-globe__location-name">{marker.label || copy.unknownLocation}</span>
                    <span className="wanderer-globe__location-value">{copy.regionPercentage(share)}</span>
                  </button>
                  <div id={panelId} className="wanderer-globe__location-panel" hidden={!open}>
                    <p className="wanderer-globe__location-summary">
                      <span>{copy.locationCount(marker.count)}</span>
                      {latestYear(marker, context.formatDate) && <span>{copy.latest}: {latestYear(marker, context.formatDate)}</span>}
                    </p>
                    <ul className="wanderer-globe__location-talks">
                      {marker.talks.map((talk) => {
                        const primary = context.getPrimaryLink(talk);
                        return (
                          <li key={talk.id}>
                            {primary ? context.renderLink(primary, talk.title, talk) : <span>{talk.title}</span>}
                            <span className="wanderer-globe__location-event"> {talk.event}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DefaultOverlayCard({ milestone, context }: { milestone: PositionedMilestone; context: TalksContext }) {
  const MilestoneImage = context.ImageComponent;
  const photoUrl = milestone.image && safeUrl(milestone.image.src, { allowRelative: true });
  return (
    <div className="wanderer-milestone">
      {milestone.image && (
        <div className="wanderer-milestone__media">
          <MilestoneImage src={milestone.image.src} alt={milestone.image.alt} width={milestone.image.width} height={milestone.image.height} loading="lazy" decoding="async" className="wanderer-milestone__image" />
        </div>
      )}
      <div className="wanderer-milestone__body">
        <p className="wanderer-milestone__title">{milestone.title}</p>
        {milestone.description && <p className="wanderer-milestone__description">{milestone.description}</p>}
        {photoUrl && <a className="wanderer-milestone__photo" href={photoUrl} target="_blank" rel="noopener noreferrer">{context.copy.viewMilestoneImage}</a>}
      </div>
    </div>
  );
}

function GlobeFallback({ kind, context }: { kind: GlobeErrorKind | 'empty'; context: TalksContext }) {
  const { copy, views, setView } = context;
  const hasList = views.some((view) => view.id === 'list');
  const action = hasList ? (
    <button type="button" className="wanderer-button" onClick={() => setView('list', 'user')}>{copy.useList}</button>
  ) : undefined;
  if (kind === 'empty') {
    return <EmptyState icon={<GlobeIcon width={28} height={28} />} title={copy.noMappedTalks} description={copy.noMappedDescription} action={action} />;
  }
  return <EmptyState icon={<GlobeIcon width={28} height={28} />} title={copy.globeUnavailable} description={copy.globeUnavailableDescription} action={action} />;
}

interface GlobeViewComponentProps extends TalkViewProps {
  options: GlobeViewOptions;
}

export function GlobeView({ context, active, options }: GlobeViewComponentProps) {
  const isClient = useIsClient();
  const reducedMotion = usePrefersReducedMotion();
  const documentVisible = useDocumentVisible();
  const stageRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stageRef);
  const { geography, copy, milestones, slots, colorScheme, theme } = context;
  const calloutPlacement = useCalloutPlacement(stageRef, context.direction);
  const [status, setStatus] = useState<GlobeStatus>('idle');
  const [Renderer, setRenderer] = useState<ComponentType<GlobeRendererProps> | null>(null);
  const [errorKind, setErrorKind] = useState<GlobeErrorKind | null>(null);
  const [activeMilestoneId, setActiveMilestoneId] = useState<string | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const automatic = !motionPaused && !reducedMotion;
  const [expandedMarker, setExpandedMarker] = useState<string | null>(null);
  const colors = useGlobeColors(stageRef, colorScheme, theme);
  const presentation = options.presentation ?? 'inline';
  const headingId = useId();

  const hasMarkers = geography.markers.length > 0;
  const webGlRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!isClient || !active || !hasMarkers) return;
    let cancelled = false;
    setStatus('loading');
    setErrorKind(null);
    // Probed once per instance; the probe context is released right after.
    if (webGlRef.current === null) webGlRef.current = hasWebGl();
    if (!webGlRef.current) {
      setErrorKind('webgl');
      setStatus('error');
      return;
    }
    loadRenderer().then((module) => {
      if (cancelled) return;
      setRenderer(() => module.default);
      setStatus('ready');
    }).catch(() => {
      if (cancelled) return;
      setErrorKind('module');
      setStatus('error');
    });
    return () => { cancelled = true; };
  }, [isClient, active, hasMarkers]);

  const positionedMilestones = useMemo<PositionedMilestone[]>(() => {
    const byId = new Map<string, Talk>(geography.mappedTalks.map((talk) => [talk.id, talk]));
    return milestones.flatMap((milestone) => {
      const talk = milestone.talkId ? byId.get(milestone.talkId) : undefined;
      const coordinates = milestone.coordinates ?? (talk ? resolveTalkCoordinates(talk, context.geographyOptions) : undefined);
      return coordinates ? [{ ...milestone, coordinates }] : [];
    });
  }, [milestones, geography.mappedTalks, context.geographyOptions]);

  const activeMilestone = positionedMilestones.find((milestone) => milestone.id === activeMilestoneId) ?? null;
  const OverlayCard = slots.GlobeOverlayCard;
  const GlobeAside = slots.GlobeAside;
  const StageOverlay = slots.GlobeStageOverlay;
  const fail = useCallback((kind: GlobeErrorKind) => {
    setErrorKind(kind);
    setStatus('error');
  }, []);
  const handleRuntimeError = useCallback(() => fail('runtime'), [fail]);
  // A lost context usually comes back within a frame or two; past the grace period the fallback takes over.
  const contextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleContextLost = useCallback(() => {
    setActiveMilestoneId(null);
    if (contextTimerRef.current !== null) return;
    contextTimerRef.current = setTimeout(() => {
      contextTimerRef.current = null;
      fail('runtime');
    }, CONTEXT_RESTORE_GRACE_MS);
  }, [fail]);
  const handleContextRestored = useCallback(() => {
    if (contextTimerRef.current === null) return;
    clearTimeout(contextTimerRef.current);
    contextTimerRef.current = null;
  }, []);
  useEffect(() => () => { if (contextTimerRef.current !== null) clearTimeout(contextTimerRef.current); }, []);
  const paused = !documentVisible || !onScreen;

  // The renderer is the only thing that activates milestones; when it is gone
  // (no mapped talks, an error) the callout must go with it.
  const rendererShown = isClient && hasMarkers && status === 'ready' && Renderer !== null;
  useEffect(() => {
    if (!rendererShown) setActiveMilestoneId(null);
  }, [rendererShown]);

  let stage: ReactNode;
  if (isClient && !hasMarkers) {
    // Nothing to draw: say so without fetching the renderer or cobe.
    stage = <GlobeFallback kind="empty" context={context} />;
  } else if (status === 'error') {
    stage = <GlobeFallback kind={errorKind ?? 'runtime'} context={context} />;
  } else if (rendererShown && Renderer) {
    stage = (
      <ErrorBoundary fallback={<GlobeFallback kind="runtime" context={context} />} onError={handleRuntimeError}>
        <Renderer
          markers={geography.markers}
          milestones={positionedMilestones}
          colors={colors}
          colorScheme={colorScheme}
          reducedMotion={reducedMotion || motionPaused}
          paused={paused}
          intro={options.intro ?? true}
          autoRotate={automatic && (options.autoRotate ?? true)}
          autoMilestones={automatic}
          showConnectors={calloutPlacement === 'beside'}
          calloutAnchor={{ x: '104%', y: '42%' }}
          copy={copy}
          locale={context.locale}
          direction={context.direction}
          formatDate={context.formatDate}
          activeMilestoneId={activeMilestoneId}
          onActiveMilestoneChange={setActiveMilestoneId}
          focusMarkerId={expandedMarker}
          onContextLost={handleContextLost}
          onContextRestored={handleContextRestored}
        />
      </ErrorBoundary>
    );
  } else {
    stage = (
      <div className="wanderer-globe__loading" role="status" aria-live="polite">
        <span className="wanderer-globe__loading-disc" aria-hidden="true" />
        <span className="wanderer-visually-hidden">{copy.loadingGlobe}</span>
      </div>
    );
  }

  const callout = activeMilestone && rendererShown ? (
    <div className="wanderer-globe__callout" data-wanderer-milestone={activeMilestone.id}>
      <button type="button" className="wanderer-button wanderer-globe__dismiss" onClick={() => {
        setMotionPaused(true);
        setActiveMilestoneId(null);
      }}>{copy.dismissMilestone}</button>
      {OverlayCard ? <OverlayCard milestone={activeMilestone} context={context} /> : <DefaultOverlayCard milestone={activeMilestone} context={context} />}
    </div>
  ) : null;

  return (
    <div
      className={`wanderer-globe wanderer-globe--${presentation}`}
      data-wanderer-globe-status={status}
      data-wanderer-globe-error={errorKind ?? undefined}
    >
      <div className="wanderer-globe__layout">
        <aside className="wanderer-globe__panel" aria-labelledby={headingId}>
          <Heading level={context.headingLevel + 1} id={headingId} className="wanderer-visually-hidden">{copy.globeLabel}</Heading>
          <div className="wanderer-globe__panel-scroll">
            <GlobeRegionList context={context} geography={geography} expanded={expandedMarker} onToggle={setExpandedMarker} />
            {GlobeAside && <GlobeAside context={context} geography={geography} />}
          </div>
          <p className="wanderer-globe__summary">{copy.mappedCount(geography.mappedCount, geography.markers.length)}</p>
        </aside>
        <div className="wanderer-globe__stage-wrap">
          <div
            ref={stageRef}
            className="wanderer-globe__stage"
            tabIndex={-1}
            role="group"
            aria-label={copy.globeLabel}
            data-wanderer-paused={paused ? 'true' : undefined}
            data-wanderer-callout={calloutPlacement}
          >
            {stage}
            {calloutPlacement === 'beside' && callout}
          </div>
          <p className="wanderer-globe__hint">{copy.globeHint}</p>
          {rendererShown && (
            <div className="wanderer-globe__controls">
              {!reducedMotion && <button type="button" className="wanderer-button" onClick={() => setMotionPaused(!motionPaused)}>{motionPaused ? copy.resumeGlobe : copy.pauseGlobe}</button>}
              {positionedMilestones.length > 0 && (
                <label className="wanderer-globe__milestones">
                  <span>{copy.milestones}</span>
                  <select value={activeMilestoneId ?? ''} onChange={(event) => {
                    setMotionPaused(true);
                    setActiveMilestoneId(event.target.value || null);
                  }}>
                    <option value="">{copy.chooseMilestone}</option>
                    {positionedMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {calloutPlacement !== 'beside' && callout}
          {StageOverlay && (
            <div className="wanderer-globe__overlay">
              <StageOverlay context={context} geography={geography} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The globe view contribution (reserved id `globe`). Pass it through `views` on `<Talks>`. */
export function globeView(options: GlobeViewOptions = {}): ViewContribution {
  const Component = (props: TalkViewProps) => <GlobeView {...props} options={options} />;
  return {
    id: 'globe',
    order: options.order ?? 10,
    label: options.label ?? '',
    heading: options.heading,
    presentation: options.presentation,
    icon: <GlobeIcon className="wanderer-views__icon" />,
    preload: preloadGlobeView,
    Component,
  };
}

export type { Geography };
