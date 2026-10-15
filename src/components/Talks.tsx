'use client';

import {
  useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState,
  type AnchorHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode, type WheelEvent,
} from 'react';
import type {
  ActionContribution, BuiltinFilterId, FilterContribution, ImageComponentProps, Milestone, NavigationOptions,
  RendererContribution, ResolvedView, TalkAction, TalksContext, TalksCopy, TalksPlugin, TalksProps,
  TalksSlots, ViewChangeReason, ViewContribution,
} from '../component-types.js';
import type { Talk, TalkGroup, TalkLink } from '../types.js';
import { TalksReactContext } from '../context.js';
import { restrictGeography } from '../geography.js';
import { mergeCopy } from '../copy.js';
import {
  DEFAULT_PRIMARY_LINK_PRECEDENCE, deriveGeography, filterTalks, formatCalendarDate, getPrimaryLink,
  getTalkLinks, groupTalks, isUpcoming, validateTalks,
} from '../helpers.js';
import { useColorScheme, useControllable, useIsClient, useMediaQuery } from '../hooks.js';
import { collectContributions, registerPlugins } from '../plugins.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { Heading } from './Heading.js';
import { listView } from './ListView.js';
import { TalkCard } from './TalkCard.js';
import { TalkLinkAnchor } from './TalkLink.js';
import { Toolbar } from './Toolbar.js';
import { ViewShell } from './ViewShell.js';

export const DEFAULT_BREAKPOINT = 1024;
const RESERVED_VIEW_IDS = ['list', 'globe'] as const;
const BUILTIN_FILTER_IDS: readonly BuiltinFilterId[] = ['recording', 'upcoming', 'online', 'in-person', 'hybrid'];
const RESERVED_ACTION_IDS = ['event', 'recording', 'slides', 'detail', 'general'] as const;
const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
const TRACKPAD_TOGGLE_DISTANCE = 110;
const TRACKPAD_MIN_DELTA = 4;
const TRACKPAD_COOLDOWN_MS = 700;
const ANNOUNCE_DELAY_MS = 600;
/** Input types that hold text the visitor edits; Escape in one with text belongs to the field. */
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** The text of an editable field, or null when the target is not one (checkboxes, ranges and buttons have values too). */
function editableText(target: EventTarget | null): string | null {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return null;
  if (element.tagName === 'TEXTAREA') return (element as HTMLTextAreaElement).value;
  if (element.tagName === 'INPUT') return TEXT_ENTRY_TYPES.has((element as HTMLInputElement).type) ? (element as HTMLInputElement).value : null;
  return element.isContentEditable ? element.textContent ?? '' : null;
}

function DefaultImage({ src, alt, width, height, loading, decoding, sizes, className }: ImageComponentProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      sizes={sizes}
      className={className}
    />
  );
}

function builtinFilterContributions(ids: readonly BuiltinFilterId[], copy: TalksCopy): FilterContribution[] {
  const all: Record<BuiltinFilterId, FilterContribution> = {
    recording: { id: 'recording', order: 0, label: copy.recordingFilter, predicate: (talk) => getTalkLinks(talk).some((link) => link.kind === 'recording') },
    upcoming: { id: 'upcoming', order: 1, label: copy.upcomingFilter, predicate: (talk, context) => isUpcoming(talk.date, context.referenceDate) },
    online: { id: 'online', order: 2, label: copy.onlineFilter, predicate: (talk) => talk.format === 'online' },
    'in-person': { id: 'in-person', order: 3, label: copy.inPersonFilter, predicate: (talk) => talk.format === 'in-person' },
    hybrid: { id: 'hybrid', order: 4, label: copy.hybridFilter, predicate: (talk) => talk.format === 'hybrid' },
  };
  return ids.filter((id, index) => BUILTIN_FILTER_IDS.includes(id) && ids.indexOf(id) === index).map((id) => all[id]);
}

interface Registry {
  views: ResolvedView[];
  filters: FilterContribution[];
  actions: ActionContribution[];
  renderers: RendererContribution[];
  slots: TalksSlots;
}

function resolveViewLabel(view: ViewContribution, copy: TalksCopy): { label: string; heading: string } {
  const fallbackLabel = view.id === 'list' ? copy.listView : view.id === 'globe' ? copy.globeView : view.id;
  const fallbackHeading = view.id === 'list' ? copy.listHeading : view.id === 'globe' ? copy.globeHeading : view.label || view.id;
  return { label: view.label || fallbackLabel, heading: view.heading || fallbackHeading };
}

/**
 * Builds the instance registry. Built-in views come first; `views` from props
 * may replace a built-in by reusing its id; plugin contributions may not use
 * reserved ids or collide with each other. Everything sorts by order, then id.
 */
function buildRegistry(
  plugins: readonly TalksPlugin[],
  extraViews: readonly ViewContribution[],
  enabledViews: readonly string[] | undefined,
  builtinFilters: readonly BuiltinFilterId[],
  slots: TalksSlots | undefined,
  copy: TalksCopy,
): Registry {
  const ordered = registerPlugins(plugins);
  const propViews = new Map<string, ViewContribution>();
  propViews.set('list', listView());
  for (const view of extraViews) propViews.set(view.id, view);
  const propViewIds = [...propViews.keys()];
  const pluginViews = collectContributions(ordered, (plugin) => plugin.views, [...RESERVED_VIEW_IDS, ...propViewIds]);
  const allViews = registerPlugins([...propViews.values(), ...pluginViews]);
  const enabled = enabledViews ? allViews.filter((view) => enabledViews.includes(view.id)) : allViews;
  const views: ResolvedView[] = enabled.map((view) => ({
    id: view.id,
    ...resolveViewLabel(view, copy),
    Component: view.Component,
    preload: view.preload,
    icon: view.icon,
    presentation: view.presentation,
  }));

  const filters = registerPlugins([
    ...builtinFilterContributions(builtinFilters, copy),
    ...collectContributions(ordered, (plugin) => plugin.filters, BUILTIN_FILTER_IDS),
  ]);
  const actions = collectContributions(ordered, (plugin) => plugin.actions, RESERVED_ACTION_IDS);
  const renderers = collectContributions(ordered, (plugin) => plugin.renderers, ['default']);

  const mergedSlots: TalksSlots = {};
  for (const plugin of ordered) {
    for (const [key, value] of Object.entries(plugin.slots ?? {}) as [keyof TalksSlots, TalksSlots[keyof TalksSlots]][]) {
      if (value && !mergedSlots[key]) (mergedSlots as Record<string, unknown>)[key] = value;
    }
  }
  for (const [key, value] of Object.entries(slots ?? {}) as [keyof TalksSlots, TalksSlots[keyof TalksSlots]][]) {
    if (value) (mergedSlots as Record<string, unknown>)[key] = value;
  }
  return { views, filters, actions, renderers, slots: mergedSlots };
}

const EMPTY_PLUGINS: readonly TalksPlugin[] = [];
const EMPTY_VIEWS: readonly ViewContribution[] = [];
const DEFAULT_BUILTIN_FILTERS: readonly BuiltinFilterId[] = ['recording', 'upcoming'];
const EMPTY_FILTERS: readonly string[] = [];
const EMPTY_MILESTONES: readonly Milestone[] = [];
const EMPTY_NAVIGATION: NavigationOptions = {};

export function Talks(props: TalksProps) {
  const {
    talks: input,
    referenceDate,
    plugins = EMPTY_PLUGINS,
    views: extraViews = EMPTY_VIEWS,
    copy: copyOverrides,
    locale = 'en-US',
    dateFormat = DEFAULT_DATE_FORMAT,
    direction = 'ltr',
    theme = 'system',
    tokens,
    className,
    style,
    density = 'comfortable',
    headingLevel = 2,
    viewHeadings = 'visible',
    defaultView,
    enabledViews,
    responsive,
    view: controlledView,
    onViewChange,
    search: controlledSearch,
    defaultSearch = '',
    onSearchChange,
    filters: controlledFilters,
    defaultFilters,
    onFiltersChange,
    builtinFilters = DEFAULT_BUILTIN_FILTERS,
    grouping = 'separate',
    geography: geographyOptions,
    navigation = EMPTY_NAVIGATION,
    milestones = EMPTY_MILESTONES,
    ImageComponent = DefaultImage,
    slots,
    escapeToList = true,
    trackpadGestures = false,
    isModalOpen,
    validation = 'lenient',
    onValidation,
  } = props;

  const instanceId = useId();
  const copy = useMemo(() => mergeCopy(copyOverrides), [copyOverrides]);
  const validationResult = useMemo(() => validateTalks(input, { mode: validation }), [input, validation]);
  useEffect(() => { onValidation?.(validationResult); }, [validationResult, onValidation]);
  const allTalks = validationResult.talks;

  const registry = useMemo(
    () => buildRegistry(plugins, extraViews, enabledViews, builtinFilters, slots, copy),
    [plugins, extraViews, enabledViews, builtinFilters, slots, copy],
  );
  const viewIds = useMemo(() => registry.views.map((view) => view.id), [registry]);
  const viewIdsRef = useRef(viewIds);
  viewIdsRef.current = viewIds;

  // View state: controlled > explicit user choice > responsive default > fixed default.
  const breakpoint = responsive?.breakpoint ?? DEFAULT_BREAKPOINT;
  const isLarge = useMediaQuery(responsive ? `(min-width: ${breakpoint}px)` : null);
  const [userView, setUserView] = useState<string | undefined>(undefined);
  // The view each breakpoint would show once a missing id falls back to the first view.
  const responsiveViews = responsive
    ? {
      small: viewIds.includes(responsive.small) ? responsive.small : viewIds[0],
      large: viewIds.includes(responsive.large) ? responsive.large : viewIds[0],
    }
    : null;
  let candidate: string | undefined;
  let pending = false;
  if (controlledView !== undefined) candidate = controlledView;
  else if (userView !== undefined) candidate = userView;
  else if (responsive) {
    if (isLarge === undefined) pending = true;
    else candidate = isLarge ? responsive.large : responsive.small;
  } else candidate = defaultView ?? viewIds[0];
  const candidateAvailable = candidate !== undefined && viewIds.includes(candidate);
  const activeView = pending ? undefined : candidateAvailable ? candidate : viewIds[0];
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  // Fullscreen opens for a view the visitor or the consumer chose (a click,
  // the `view` prop, a fixed `defaultView`), never for the responsive pick on
  // load or on a breakpoint crossing, and only after hydration: the server
  // HTML and the first client render show every view inline.
  const isClient = useIsClient();
  const fullscreenAllowed = isClient && candidateAvailable
    && (controlledView !== undefined || userView !== undefined || !responsive);

  const reasonRef = useRef<ViewChangeReason | null>(null);
  const previousViewRef = useRef<string | undefined>(undefined);
  /** The unavailable candidate last reported, so one rejected request is announced once. */
  const lastUnavailableRef = useRef<string | undefined>(undefined);
  const lastLargeRef = useRef(isLarge);
  const focusRequestRef = useRef<{ view: string; source: Element | null } | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  useEffect(() => {
    if (activeView === undefined) return;
    const largeChanged = lastLargeRef.current !== isLarge;
    lastLargeRef.current = isLarge;
    const previous = previousViewRef.current;
    const unavailable = !candidateAvailable;
    if (previous === activeView && (!unavailable || lastUnavailableRef.current === candidate)) {
      if (!unavailable) lastUnavailableRef.current = undefined;
      return;
    }
    previousViewRef.current = activeView;
    lastUnavailableRef.current = unavailable ? candidate : undefined;
    const requested = reasonRef.current;
    reasonRef.current = null;
    // The reason follows what drove the change: a rejected request, an
    // explicit setView, the first resolution, the consumer's prop, the user's
    // earlier choice coming back into effect, or the breakpoint crossing.
    let reason: ViewChangeReason;
    if (unavailable) reason = 'unavailable';
    else if (requested !== null) reason = requested;
    else if (previous === undefined) reason = controlledView !== undefined ? 'controlled' : 'initial';
    else if (controlledView !== undefined) reason = 'controlled';
    else if (userView !== undefined) reason = 'user';
    else if (largeChanged) reason = 'responsive';
    else reason = 'initial';
    // A controlled change is the consumer's own prop update: setView already
    // reported the user's intent, so only the initial resolution and an
    // unavailable fallback are worth announcing.
    if (controlledView !== undefined && previous !== undefined && reason !== 'unavailable') return;
    onViewChangeRef.current?.(activeView, { reason, previousView: previous });
  }, [activeView, candidate, candidateAvailable, controlledView, userView, isLarge]);

  const viewHeadingId = useCallback((view: string) => `${instanceId}-view-${view}-heading`, [instanceId]);

  useEffect(() => {
    // A controlled parent may accept asynchronously. Keep the request only
    // while focus remains where the user made it; later prop updates must
    // never steal focus from a search field or another part of the page.
    const cancelMovedFocus = (event: FocusEvent) => {
      const request = focusRequestRef.current;
      if (request?.source?.isConnected && event.target !== request.source) focusRequestRef.current = null;
    };
    document.addEventListener('focusin', cancelMovedFocus);
    return () => document.removeEventListener('focusin', cancelMovedFocus);
  }, []);

  useEffect(() => {
    const target = focusRequestRef.current?.view;
    if (!target || typeof document === 'undefined') return;
    if (target !== activeView) return;
    focusRequestRef.current = null;
    document.getElementById(viewHeadingId(target))?.focus();
  }, [activeView, viewHeadingId]);

  const setView = useCallback((next: string, reason: ViewChangeReason = 'user') => {
    if (!viewIdsRef.current.includes(next)) return;
    if (next === activeViewRef.current) {
      // Already shown: no change to report and no focus to move. Choosing it
      // again still makes it the visitor's choice, so an immersive view the
      // responsive default showed inline opens fullscreen.
      if (reason === 'user' && controlledView === undefined) setUserView(next);
      return;
    }
    reasonRef.current = reason;
    if (reason === 'user') focusRequestRef.current = { view: next, source: document.activeElement };
    if (controlledView === undefined) {
      setUserView(next);
    } else if (next !== controlledView) {
      onViewChangeRef.current?.(next, { reason, previousView: controlledView });
    }
  }, [controlledView]);

  // Search and filter state (each independently controllable).
  const [search, setSearch] = useControllable(controlledSearch, defaultSearch, onSearchChange);
  const [filters, setFilters] = useControllable<readonly string[]>(controlledFilters, defaultFilters ?? EMPTY_FILTERS, onFiltersChange);
  const toggleFilter = useCallback((id: string) => {
    setFilters(filters.includes(id) ? filters.filter((item) => item !== id) : [...filters, id]);
  }, [filters, setFilters]);
  const resetAll = useCallback(() => { setSearch(''); setFilters(EMPTY_FILTERS); }, [setSearch, setFilters]);

  const hasActiveFilters = search.trim().length > 0 || registry.filters.some((filter) => filters.includes(filter.id));

  // The input and chips update at once; filtering, grouping and re-rendering a
  // long list follow in an interruptible render, so typing stays responsive.
  const deferredSearch = useDeferredValue(search);
  const deferredFilters = useDeferredValue(filters);
  const activeFilters = useMemo(
    () => registry.filters.filter((filter) => deferredFilters.includes(filter.id)),
    [registry.filters, deferredFilters],
  );
  const talks = useMemo(() => {
    const predicateContext = { referenceDate, allTalks, search: deferredSearch, filters: deferredFilters };
    return filterTalks(allTalks, {
      search: deferredSearch,
      predicates: activeFilters.map((filter) => (talk: Talk) => filter.predicate(talk, predicateContext)),
    });
  }, [allTalks, deferredSearch, deferredFilters, activeFilters, referenceDate]);

  const groups = useMemo(
    () => groupTalks(talks, { referenceDate, upcoming: grouping, undatedLabel: copy.undated, upcomingLabel: copy.upcoming, locale }),
    [talks, referenceDate, grouping, copy, locale],
  );

  const resolvedGeographyOptions = useMemo(() => ({
    ...geographyOptions,
    unassignedRegion: geographyOptions?.unassignedRegion === undefined ? copy.unassignedRegion : geographyOptions.unassignedRegion,
  }), [geographyOptions, copy]);
  // Markers merge once from every talk so search and filters never re-host a location.
  const allGeography = useMemo(() => deriveGeography(allTalks, resolvedGeographyOptions), [allTalks, resolvedGeographyOptions]);
  const geography = useMemo(() => restrictGeography(allGeography, talks, resolvedGeographyOptions), [allGeography, talks, resolvedGeographyOptions]);

  const rootRef = useRef<HTMLElement>(null);
  const colorScheme = useColorScheme(theme, rootRef);
  const shellKeyRef = useRef<string | null>(null);
  const pendingShellKeysRef = useRef<string[]>([]);

  // Polite result announcement, debounced so typing does not flood screen readers.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!hasActiveFilters) { setAnnouncement(''); return; }
    const text = copy.resultCount(talks.length, allTalks.length);
    const timer = setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasActiveFilters, talks.length, allTalks.length, copy]);

  const formatDate = useCallback(
    (date: string, options?: Intl.DateTimeFormatOptions) => formatCalendarDate(date, locale, options ?? dateFormat, copy.undated),
    [locale, dateFormat, copy],
  );
  const primaryPrecedence = navigation.primaryLink ?? DEFAULT_PRIMARY_LINK_PRECEDENCE;
  const getPrimary = useCallback((talk: Talk) => getPrimaryLink(talk, primaryPrecedence), [primaryPrecedence]);
  const upcomingFor = useCallback((talk: Talk) => isUpcoming(talk.date, referenceDate), [referenceDate]);

  const renderLink = useCallback(
    (link: TalkLink, children: ReactNode, talk?: Talk, extra?: AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <TalkLinkAnchor link={link} talk={talk} navigation={navigation} {...extra}>{children}</TalkLinkAnchor>
    ),
    [navigation],
  );

  const contextRef = useRef<TalksContext | null>(null);
  const getActions = useCallback((talk: Talk): TalkAction[] => {
    const primary = getPrimary(talk);
    // Action ids are React keys: plugin ids are reserved first, and a data link
    // id that still collides (the validator only checks within one talk) gets a suffix.
    const usedIds = new Set(registry.actions.map((action) => action.id));
    const uniqueId = (id: string) => {
      let next = id;
      for (let n = 2; usedIds.has(next); n += 1) next = `${id}-${n}`;
      usedIds.add(next);
      return next;
    };
    const linkActions: TalkAction[] = getTalkLinks(talk)
      .filter((link) => link !== primary && !(primary && link.kind === primary.kind && link.url === primary.url))
      .map((link, index) => ({
        id: uniqueId(link.id ?? `${link.kind}-${index}`),
        kind: link.kind,
        label: typeof link.label === 'string' && link.label.trim() ? link.label : copy[`${link.kind}Action`],
        link,
      }));
    const pluginActions: TalkAction[] = registry.actions
      .filter((action) => !action.when || action.when(talk))
      .map((action) => {
        const link = action.getLink?.(talk);
        return {
          id: action.id,
          kind: link?.kind,
          label: typeof action.label === 'function' ? action.label(talk) : action.label,
          link,
          icon: action.icon,
          onAction: !link && action.onAction
            ? () => { if (contextRef.current) action.onAction?.(talk, contextRef.current); }
            : undefined,
        };
      })
      // No link and no handler: nothing to render, rather than an inert button.
      .filter((action) => action.link || action.onAction);
    return [...linkActions, ...pluginActions];
  }, [getPrimary, copy, registry.actions]);

  const renderTalk = useCallback((talk: Talk, group?: TalkGroup): ReactNode => {
    const context = contextRef.current;
    if (!context) return null;
    const upcoming = upcomingFor(talk);
    const renderer = registry.renderers.find((item) => !item.when || item.when(talk));
    if (!renderer) return <TalkCard talk={talk} context={context} upcoming={upcoming} group={group} />;
    const Custom = renderer.Component;
    return (
      <ErrorBoundary fallback={<p className="wanderer-error" role="alert">{copy.pluginError}</p>}>
        <Custom talk={talk} context={context} upcoming={upcoming} group={group} />
      </ErrorBoundary>
    );
  }, [registry.renderers, upcomingFor, copy]);

  const context = useMemo<TalksContext>(() => ({
    instanceId,
    allTalks,
    talks,
    groups,
    geography,
    geographyOptions: resolvedGeographyOptions,
    validation: validationResult,
    referenceDate,
    copy,
    locale,
    dateFormat,
    direction,
    theme,
    colorScheme,
    breakpoint,
    density,
    headingLevel,
    view: activeView,
    views: registry.views,
    setView,
    viewHeadingId,
    search,
    setSearch,
    filters,
    setFilters,
    toggleFilter,
    availableFilters: registry.filters,
    hasActiveFilters,
    resetAll,
    isUpcoming: upcomingFor,
    formatDate,
    getLinks: getTalkLinks,
    getPrimaryLink: getPrimary,
    getActions,
    renderTalk,
    renderLink,
    navigation,
    milestones,
    ImageComponent,
    slots: registry.slots,
    grouping,
  }), [
    instanceId, allTalks, talks, groups, geography, resolvedGeographyOptions, validationResult, referenceDate, copy,
    locale, dateFormat, direction, theme, colorScheme, breakpoint, density, headingLevel, activeView, registry, setView,
    viewHeadingId, search, setSearch, filters, setFilters, toggleFilter, hasActiveFilters, resetAll, upcomingFor,
    formatDate, getPrimary, getActions, renderTalk, renderLink, navigation, milestones, ImageComponent, grouping,
  ]);
  contextRef.current = context;

  // Keyboard: Escape returns to the list when focus is inside the component.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!escapeToList || event.key !== 'Escape' || event.defaultPrevented) return;
    if (isModalOpen?.()) return;
    if (editableText(event.target)) {
      // A text field with text keeps Escape, and a fullscreen dialog stays
      // open. Only the component's own search field (built in or the
      // SearchInput slot) is cleared; a plugin's field handles Escape itself.
      event.preventDefault();
      if ((event.target as Element).closest('.wanderer-toolbar__search')) setSearch('');
      return;
    }
    if (activeView === 'list' || !viewIds.includes('list')) return;
    event.preventDefault();
    setView('list', 'user');
  };

  // Trackpad: horizontal swipes cycle views. Opt-in; never prevents default scrolling.
  const swipeAccumulator = useRef(0);
  const lastSwipeAt = useRef(0);
  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    if (!trackpadGestures || pending || viewIds.length < 2) return;
    if (isModalOpen?.()) return;
    const absX = Math.abs(event.deltaX);
    if (absX < TRACKPAD_MIN_DELTA || absX <= Math.abs(event.deltaY)) return;
    const now = event.timeStamp;
    if (now - lastSwipeAt.current < TRACKPAD_COOLDOWN_MS) return;
    swipeAccumulator.current += event.deltaX;
    if (Math.abs(swipeAccumulator.current) < TRACKPAD_TOGGLE_DISTANCE) return;
    const step = (swipeAccumulator.current > 0 ? 1 : -1) * (direction === 'rtl' ? -1 : 1);
    swipeAccumulator.current = 0;
    lastSwipeAt.current = now;
    const index = viewIds.indexOf(activeView ?? viewIds[0]);
    const next = viewIds[(index + step + viewIds.length) % viewIds.length];
    setView(next, 'user');
  };

  const rootStyle = useMemo<CSSProperties | undefined>(() => {
    if (!tokens && !style) return style;
    return { ...(tokens as CSSProperties), ...style };
  }, [tokens, style]);

  if (validation === 'strict' && !validationResult.valid) {
    return (
      <section
        className={`wanderer wanderer--error${className ? ` ${className}` : ''}`}
        data-wanderer-theme={theme}
        data-wanderer-instance={instanceId}
        dir={direction}
        style={rootStyle}
        role="alert"
      >
        <p className="wanderer-error">{copy.validationError}</p>
      </section>
    );
  }

  // Before the viewport is measured, responsive mode renders one shell per
  // breakpoint (or a single shell when both resolve to the same view, so ids
  // stay unique). The shell that survives keeps its React key, so React drops
  // only the losing shell and the server-rendered DOM, state, and focus of the
  // surviving one are preserved through hydration.
  let shells: { key: string; shell: string; view: string | undefined; modifier: string }[];
  if (pending && responsiveViews) {
    shells = responsiveViews.small === responsiveViews.large
      ? [{ key: 'active', shell: 'active', view: responsiveViews.small, modifier: 'wanderer-shell--active' }]
      : [
        { key: 'small', shell: 'small', view: responsiveViews.small, modifier: 'wanderer-shell--small' },
        { key: 'large', shell: 'large', view: responsiveViews.large, modifier: 'wanderer-shell--large' },
      ];
    pendingShellKeysRef.current = shells.map((shell) => shell.key);
  } else {
    if (shellKeyRef.current === null) {
      const pendingKeys = pendingShellKeysRef.current;
      shellKeyRef.current = pendingKeys.length === 1
        ? pendingKeys[0]
        : pendingKeys.length === 2 && isLarge !== undefined ? (isLarge ? 'large' : 'small') : 'active';
    }
    shells = [{ key: shellKeyRef.current, shell: 'active', view: activeView, modifier: 'wanderer-shell--active' }];
  }

  const customBreakpointStyle = shells.length === 2 && breakpoint !== DEFAULT_BREAKPOINT
    ? `@media (min-width:${breakpoint}px){[data-wanderer-instance="${instanceId}"] .wanderer-shell--small{display:none}}`
      + `@media (max-width:${breakpoint - 0.02}px){[data-wanderer-instance="${instanceId}"] .wanderer-shell--large{display:none}}`
    : null;

  return (
    <TalksReactContext.Provider value={context}>
      <section
        ref={rootRef}
        className={`wanderer${className ? ` ${className}` : ''}`}
        data-wanderer-theme={theme}
        data-wanderer-density={density}
        data-wanderer-instance={instanceId}
        data-wanderer-view={activeView}
        data-wanderer-view-small={pending && responsiveViews ? responsiveViews.small : undefined}
        data-wanderer-view-large={pending && responsiveViews ? responsiveViews.large : undefined}
        data-wanderer-breakpoint={responsive ? breakpoint : undefined}
        dir={direction}
        style={rootStyle}
        aria-label={copy.rootLabel}
        onKeyDown={handleKeyDown}
        onWheel={trackpadGestures ? handleWheel : undefined}
      >
        {customBreakpointStyle && <style>{customBreakpointStyle}</style>}
        {shells.map((shell) => {
          const view = registry.views.find((item) => item.id === shell.view);
          const headingId = shell.view ? viewHeadingId(shell.view) : undefined;
          const exitView = registry.views.find((item) => item.id !== view?.id && item.presentation !== 'immersive');
          const exit = () => { if (exitView) setView(exitView.id, 'user'); };
          const immersive = fullscreenAllowed && view?.presentation === 'immersive' && !!exitView;
          return (
            <ViewShell
              key={shell.key}
              immersive={immersive}
              active={!pending}
              headingId={headingId}
              className={`wanderer-shell ${shell.modifier}`}
              shell={shell.shell}
              closeLabel={copy.exitFullscreen}
              onExit={exit}
              onEscape={() => { if (escapeToList && !isModalOpen?.()) exit(); }}
            >
              <Toolbar context={context} activeView={shell.view} shellKey={shell.key} />
              {view && headingId && (
                <div className="wanderer-view" data-wanderer-view-id={view.id}>
                  <Heading
                    level={headingLevel}
                    id={headingId}
                    tabIndex={-1}
                    className={`wanderer-view__heading${viewHeadings === 'visually-hidden' ? ' wanderer-visually-hidden wanderer-visually-hidden--focusable' : ''}`}
                  >
                    {view.heading}
                  </Heading>
                  <ErrorBoundary
                    resetKey={view.id}
                    fallback={<p className="wanderer-error" role="alert">{copy.pluginError}</p>}
                  >
                    <view.Component
                      context={context}
                      active={!pending}
                      headingId={headingId}
                      viewId={view.id}
                      presentation={immersive ? 'immersive' : 'inline'}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {!view && (
                <p className="wanderer-empty__title">{copy.noTalks}</p>
              )}
              <p className="wanderer-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
                {announcement}
              </p>
            </ViewShell>
          );
        })}
      </section>
    </TalksReactContext.Provider>
  );
}
