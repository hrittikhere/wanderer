/** Calendar dates are ISO YYYY-MM-DD strings, interpreted exclusively in UTC. */
export type CalendarDate = string;
export type Coordinates = readonly [latitude: number, longitude: number];
export type TalkFormat = 'in-person' | 'online' | 'hybrid';
export type LinkKind = 'event' | 'recording' | 'slides' | 'detail' | 'general';

export interface TalkLink {
  id?: string;
  kind: LinkKind;
  url: string;
  label?: string;
}

export interface Talk {
  id: string;
  title: string;
  event: string;
  date: CalendarDate;
  description: string;
  location?: string | { city: string; country: string };
  coordinates?: Coordinates;
  format: TalkFormat;
  eventUrl?: string;
  recordingUrl?: string;
  slidesUrl?: string;
  detailUrl?: string;
  /** Preserve unclassified sources with kind: 'general'; URLs never imply a kind. */
  links?: readonly TalkLink[];
  tags?: readonly string[];
}

export interface Diagnostic {
  index: number;
  talkId?: string;
  field: string;
  code: string;
  message: string;
}

export interface ValidationOptions {
  /** strict (default) returns no talks when any error exists; lenient keeps usable talks. */
  mode?: 'strict' | 'lenient';
}

export interface ValidationResult {
  /** Strict validation returns no talks if any errors exist. Warnings never reject. */
  talks: Talk[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
  valid: boolean;
}

export interface FilterOptions {
  search?: string;
  format?: TalkFormat | 'all';
  recordingOnly?: boolean;
  upcomingOnly?: boolean;
  referenceDate?: CalendarDate;
  predicates?: readonly ((talk: Talk) => boolean)[];
}

export interface GroupOptions {
  referenceDate?: CalendarDate;
  /** Separate (default) excludes upcoming from years; duplicate includes both. */
  upcoming?: 'separate' | 'duplicate' | 'none';
  undatedLabel?: string;
  upcomingLabel?: string;
  /**
   * Formats year group labels with Intl.DateTimeFormat `{ year: 'numeric' }` in this locale (UTC), as a range
   * when a group's talks span two years of the locale's calendar. Without it labels are the Gregorian year.
   * Ids stay `year-YYYY` either way.
   */
  locale?: string;
}

export interface TalkGroup {
  id: string;
  label: string;
  talks: Talk[];
}

export interface GeographyOptions {
  /** Called only when a talk has no explicit coordinates. Online talks are never resolved. */
  resolveCoordinates?: (talk: Talk) => Coordinates | null | undefined;
  /** Great-circle kilometers. Default: 64. Zero merges identical points only, including longitude 180 and -180 or any two longitudes at a pole. */
  mergeDistanceKm?: number;
  /** When omitted, no region summary is produced (locations are still listed). */
  assignRegion?: (talk: Talk, coordinates: Coordinates) => string | null | undefined;
  /** Label for talks the assigner leaves unassigned. Default "Unassigned"; null hides them (they stay in the denominator). */
  unassignedRegion?: string | null;
}

export interface GlobeMarker {
  id: string;
  coordinates: Coordinates;
  label: string;
  count: number;
  talks: Talk[];
  latestTalk: Talk;
}

export interface RegionCount {
  id: string;
  count: number;
  percentage: number;
}

export interface Geography {
  mappedTalks: Talk[];
  mappedCount: number;
  markers: GlobeMarker[];
  regions: RegionCount[];
}
