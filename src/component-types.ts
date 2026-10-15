import type { AnchorHTMLAttributes, ComponentType, CSSProperties, MouseEvent, ReactNode } from 'react';
import type {
  Coordinates, Geography, GeographyOptions, LinkKind, Talk, TalkGroup, TalkLink, ValidationResult,
} from './types.js';

export type Theme = 'light' | 'dark' | 'system';
export type ColorScheme = 'light' | 'dark';
export type TextDirection = 'ltr' | 'rtl';
export type Density = 'comfortable' | 'compact';
export type GroupingMode = 'separate' | 'duplicate' | 'none';
export type BuiltinFilterId = 'recording' | 'upcoming' | 'online' | 'in-person' | 'hybrid';
export type FilterId = BuiltinFilterId | (string & {});
/**
 * Inline `--wanderer-*` custom properties. React writes custom properties as
 * they are, so a number gets no unit: use numbers only for unitless tokens
 * (`--wanderer-line-height`, `--wanderer-z-overlay`) and strings with units
 * for lengths, durations and colors.
 */
export type ThemeTokens = Partial<Record<`--wanderer-${string}`, string | number>>;

/**
 * Why a view changed.
 * - initial: the first resolution of a responsive default after hydration.
 * - user: an explicit action inside the component (toggle, Escape, gesture); focus moves to the view heading.
 * - responsive: the breakpoint crossed and the user had not chosen a view yet.
 * - unavailable: the requested view is disabled or missing, so the first available view is shown.
 * - controlled: the `view` prop changed.
 */
export type ViewChangeReason = 'initial' | 'user' | 'responsive' | 'unavailable' | 'controlled';
export interface ViewChange {
  reason: ViewChangeReason;
  previousView: string | undefined;
}

/** Every visible string and accessible label. Functions receive numbers, never preformatted text. */
export interface TalksCopy {
  rootLabel: string;
  viewsLabel: string;
  listView: string;
  globeView: string;
  listHeading: string;
  globeHeading: string;
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  filtersLabel: string;
  recordingFilter: string;
  upcomingFilter: string;
  onlineFilter: string;
  inPersonFilter: string;
  hybridFilter: string;
  clearFilters: string;
  resetAll: string;
  upcoming: string;
  upcomingBadge: string;
  undated: string;
  /** Shown in a talk card's margin in place of the month abbreviation when the talk has no valid date. */
  undatedMonth: string;
  noTalks: string;
  noTalksDescription: string;
  noMatches: string;
  noMatchesDescription: string;
  loadingGlobe: string;
  globeUnavailable: string;
  globeUnavailableDescription: string;
  noMappedTalks: string;
  noMappedDescription: string;
  useList: string;
  backToList: string;
  exitFullscreen: string;
  regions: string;
  locations: string;
  unassignedRegion: string;
  unknownLocation: string;
  globeLabel: string;
  globeHint: string;
  milestones: string;
  chooseMilestone: string;
  pauseGlobe: string;
  resumeGlobe: string;
  dismissMilestone: string;
  viewMilestoneImage: string;
  latest: string;
  eventAction: string;
  recordingAction: string;
  slidesAction: string;
  detailAction: string;
  generalAction: string;
  online: string;
  inPerson: string;
  hybrid: string;
  validationError: string;
  pluginError: string;
  resultCount: (count: number, total: number) => string;
  groupCount: (count: number) => string;
  mappedCount: (mapped: number, locations: number) => string;
  locationCount: (count: number) => string;
  regionPercentage: (percentage: number) => string;
  actionLabel: (action: string, title: string) => string;
}

/** Copy overrides. Keys left out, `undefined` or `null` keep the English default. */
export type CopyOverrides = { [K in keyof TalksCopy]?: TalksCopy[K] | null | undefined };

export type LinkComponentProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode };

export interface LinkPolicy {
  /** `_blank` opens a new tab; `undefined` or `_self` stays in the window. Keywords match case-insensitively, as in HTML. */
  target?: '_self' | '_blank' | (string & {});
  /** Explicit rel. With no rel, `_blank` links get `noopener noreferrer`; a rel lacking both gets `noopener` appended. */
  rel?: string;
}

export interface NavigationOptions {
  /** Rendered instead of `<a>` for the kinds in `linkComponentKinds` (default: detail links). */
  LinkComponent?: ComponentType<LinkComponentProps>;
  linkComponentKinds?: readonly LinkKind[];
  /** Called for unmodified primary clicks on same-window links without a `download` attribute; the default navigation is prevented. */
  onNavigate?: (link: TalkLink, talk: Talk | undefined, event: MouseEvent<HTMLAnchorElement>) => void;
  /** Per-kind target/rel. Defaults: detail stays in the window, everything else opens a new tab. */
  policies?: Partial<Record<LinkKind, LinkPolicy>>;
  /** Which link becomes the talk title link. Default: detail, event, recording, slides, general. */
  primaryLink?: readonly LinkKind[];
}

export interface MilestoneImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  /** Anchors the callout on the globe. Falls back to the referenced talk's coordinates. */
  coordinates?: Coordinates;
  talkId?: string;
  image?: MilestoneImage;
}

export interface ImageComponentProps extends MilestoneImage {
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  sizes?: string;
  className?: string;
}

export interface SearchSlotProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  resultCount: number;
  context: TalksContext;
}

export interface GlobeOverlayCardProps {
  milestone: Milestone;
  context: TalksContext;
}

export interface GlobeAsideProps {
  context: TalksContext;
  geography: Geography;
}

export interface TalksSlots {
  SearchInput?: ComponentType<SearchSlotProps>;
  GlobeOverlayCard?: ComponentType<GlobeOverlayCardProps>;
  /** Extra instance-scoped content rendered inside the globe panel beside the location list. */
  GlobeAside?: ComponentType<GlobeAsideProps>;
  /** Content layered over the globe stage (absolutely positioned by the consumer's CSS). */
  GlobeStageOverlay?: ComponentType<GlobeAsideProps>;
}

export interface TalkRendererProps {
  talk: Talk;
  context: TalksContext;
  upcoming: boolean;
  group?: TalkGroup;
}

export interface TalkViewProps {
  context: TalksContext;
  /** False for both shells during the pre-hydration responsive render, true once a single view is active. */
  active: boolean;
  headingId: string;
  viewId: string;
  /**
   * How the shell presents the view right now. `immersive` only inside the
   * fullscreen dialog: an immersive view shows inline before hydration, for
   * the responsive default, and without an inline view to exit to.
   */
  presentation?: 'inline' | 'immersive';
}

export interface ViewContribution {
  id: string;
  order?: number;
  /** Empty strings fall back to copy for the reserved `list` and `globe` ids. */
  label: string;
  heading?: string;
  /**
   * Fullscreen dialog, including the toolbar, once the visitor or the consumer
   * chooses the view. Shown inline before hydration, when it is only the
   * responsive default, and without an inline view to exit to.
   */
  presentation?: 'inline' | 'immersive';
  icon?: ReactNode;
  Component: ComponentType<TalkViewProps>;
  /** Invoked when the view is about to be shown; useful for lazy chunks. */
  preload?: () => Promise<unknown>;
}

export interface FilterPredicateContext {
  referenceDate?: string;
  allTalks: readonly Talk[];
  search: string;
  filters: readonly string[];
}

export interface FilterContribution {
  id: string;
  order?: number;
  label: string;
  predicate: (talk: Talk, context: FilterPredicateContext) => boolean;
}

export interface ActionContribution {
  id: string;
  order?: number;
  label: string | ((talk: Talk) => string);
  when?: (talk: Talk) => boolean;
  /** Rendered as a link through the navigation options when present. */
  getLink?: (talk: Talk) => TalkLink | undefined;
  /** Rendered as a button when no link is returned. With neither a link nor `onAction`, the action is skipped for that talk. */
  onAction?: (talk: Talk, context: TalksContext) => void;
  icon?: ReactNode;
}

export interface RendererContribution {
  id: string;
  order?: number;
  when?: (talk: Talk) => boolean;
  Component: ComponentType<TalkRendererProps>;
}

/** Contributions sort by order, then by code-point ID. Duplicate or reserved IDs throw. */
export interface TalksPlugin {
  id: string;
  order?: number;
  views?: readonly ViewContribution[];
  filters?: readonly FilterContribution[];
  actions?: readonly ActionContribution[];
  renderers?: readonly RendererContribution[];
  slots?: TalksSlots;
}

/** A talk action resolved for rendering: a typed link, or a button. */
export interface TalkAction {
  id: string;
  label: string;
  kind?: LinkKind;
  link?: TalkLink;
  onAction?: () => void;
  icon?: ReactNode;
}

export interface ResolvedView {
  id: string;
  label: string;
  heading: string;
  presentation?: 'inline' | 'immersive';
  icon?: ReactNode;
  Component: ComponentType<TalkViewProps>;
  preload?: () => Promise<unknown>;
}

export interface TalksContext {
  instanceId: string;
  allTalks: readonly Talk[];
  talks: readonly Talk[];
  groups: readonly TalkGroup[];
  geography: Geography;
  geographyOptions: GeographyOptions;
  validation: ValidationResult;
  referenceDate?: string;
  copy: TalksCopy;
  locale: string;
  dateFormat: Intl.DateTimeFormatOptions;
  direction: TextDirection;
  theme: Theme;
  /** Resolved on the client; `light` during SSR and the first hydration render when theme is `system`. */
  colorScheme: ColorScheme;
  /** The responsive breakpoint in CSS pixels (DEFAULT_BREAKPOINT when `responsive` is not set). */
  breakpoint: number;
  density: Density;
  headingLevel: number;
  view: string | undefined;
  views: readonly ResolvedView[];
  setView: (view: string, reason?: ViewChangeReason) => void;
  viewHeadingId: (view: string) => string;
  /**
   * The search and filters the current `talks` reflect. While a long list
   * re-renders after a keystroke they can trail the field by one render; the
   * setters always apply to the latest value.
   */
  search: string;
  /** Accepts a value or a function of the latest value. */
  setSearch: (value: string | ((previous: string) => string)) => void;
  filters: readonly string[];
  /** Accepts a value or a function of the latest value, so several updates in one handler compose. */
  setFilters: (value: readonly string[] | ((previous: readonly string[]) => readonly string[])) => void;
  /** Adds or removes one id from the latest filters; two calls in one handler compose. */
  toggleFilter: (id: string) => void;
  availableFilters: readonly FilterContribution[];
  hasActiveFilters: boolean;
  resetAll: () => void;
  isUpcoming: (talk: Talk) => boolean;
  formatDate: (date: string, options?: Intl.DateTimeFormatOptions) => string;
  getLinks: (talk: Talk) => TalkLink[];
  getPrimaryLink: (talk: Talk) => TalkLink | undefined;
  getActions: (talk: Talk) => TalkAction[];
  renderTalk: (talk: Talk, group?: TalkGroup) => ReactNode;
  /** Renders through `TalkLinkAnchor`. `href`, `target` and `rel` in `props` are ignored: they come from the link and its kind policy. */
  renderLink: (link: TalkLink, children: ReactNode, talk?: Talk, props?: AnchorHTMLAttributes<HTMLAnchorElement>) => ReactNode;
  navigation: NavigationOptions;
  milestones: readonly Milestone[];
  ImageComponent: ComponentType<ImageComponentProps>;
  slots: TalksSlots;
  grouping: GroupingMode;
}

export interface ResponsiveViews {
  /** Minimum width in CSS pixels for the large view. Default 1024. */
  breakpoint?: number;
  small: string;
  large: string;
}

export interface TalksProps {
  talks: readonly Talk[] | readonly unknown[];
  /** ISO calendar date used for upcoming classification. Never read from the clock inside the library. */
  referenceDate?: string;
  plugins?: readonly TalksPlugin[];
  /** Additional views registered beside the built-in list (for example `globeView()`). */
  views?: readonly ViewContribution[];
  copy?: CopyOverrides | undefined;
  locale?: string;
  dateFormat?: Intl.DateTimeFormatOptions;
  direction?: TextDirection;
  theme?: Theme;
  tokens?: ThemeTokens;
  className?: string;
  style?: CSSProperties;
  density?: Density;
  /** Heading level of view headings; groups and talk titles use the next two levels. Default 2. */
  headingLevel?: 1 | 2 | 3 | 4;
  /** Visually hide view headings when the host page already has a heading. They remain focus targets. */
  viewHeadings?: 'visible' | 'visually-hidden';
  /** Uncontrolled fixed default. Ignored when `responsive` is supplied. */
  defaultView?: string;
  enabledViews?: readonly string[];
  responsive?: ResponsiveViews;
  /** Controlled view id; `undefined` leaves the view uncontrolled. */
  view?: string | undefined;
  onViewChange?: (view: string, change: ViewChange) => void;
  /** Controlled search text; `undefined` leaves the search uncontrolled. */
  search?: string | undefined;
  defaultSearch?: string;
  onSearchChange?: (search: string) => void;
  /** Controlled active filter ids; `undefined` leaves the filters uncontrolled. Ids that no offered filter matches are kept but have no effect. */
  filters?: readonly FilterId[] | undefined;
  defaultFilters?: readonly FilterId[];
  onFiltersChange?: (filters: readonly FilterId[]) => void;
  /** Built-in filters to offer. Default: recording and upcoming. */
  builtinFilters?: readonly BuiltinFilterId[];
  grouping?: GroupingMode;
  geography?: GeographyOptions;
  navigation?: NavigationOptions;
  milestones?: readonly Milestone[];
  ImageComponent?: ComponentType<ImageComponentProps>;
  slots?: TalksSlots;
  /** Escape returns to the list view when focus is inside the component. Default true. */
  escapeToList?: boolean;
  /** Horizontal trackpad swipes cycle views. Default false. */
  trackpadGestures?: boolean;
  /** Consumer-owned dialogs can veto keyboard shortcuts. */
  isModalOpen?: () => boolean;
  /** strict renders an error state when the data has errors; lenient (default) keeps usable talks. */
  validation?: 'strict' | 'lenient';
  onValidation?: (result: ValidationResult) => void;
}
