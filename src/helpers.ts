import type {
  Coordinates, FilterOptions, Geography, GeographyOptions, GlobeMarker,
  GroupOptions, LinkKind, Talk, TalkGroup, TalkLink, ValidationResult,
} from './types.js';
import type { ValidationOptions } from './types.js';

export type * from './types.js';
export { collectContributions, definePlugin, registerPlugins } from './plugins.js';
export type { Registration } from './plugins.js';
import { compareIds } from './ids.js';

export { compareIds };

/** Reject overflow dates rather than allowing JavaScript's automatic normalization. */
export function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Parsing ISO directly also avoids Date.UTC's special interpretation of years 0–99.
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? date : null;
}

const FORMATTER_CACHE_LIMIT = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Constructing Intl.DateTimeFormat costs far more than formatting, so instances are reused per locale and options. */
function utcFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}\u0000${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    const oldest = formatters.size >= FORMATTER_CACHE_LIMIT ? formatters.keys().next().value : undefined;
    if (oldest !== undefined) formatters.delete(oldest);
    formatters.set(key, formatter);
  }
  return formatter;
}

export function formatCalendarDate(
  value: unknown,
  locale = 'en-US',
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
  undated = 'Undated',
): string {
  const date = parseCalendarDate(value);
  return date ? utcFormatter(locale, options).format(date) : undated;
}

export function isUpcoming(value: unknown, referenceDate: unknown): boolean {
  const date = parseCalendarDate(value);
  const reference = parseCalendarDate(referenceDate);
  return !!date && !!reference && date.getTime() >= reference.getTime();
}

/** Valid dates precede undated entries; ties always use ascending ID ordering. */
export function sortTalks<T extends Talk>(talks: readonly T[], order: 'asc' | 'desc' = 'desc'): T[] {
  // Parse each date once up front; parsing inside the comparator repeats it O(n log n) times.
  const keyed = talks.map((talk) => ({ talk, time: parseCalendarDate(talk.date)?.getTime() }));
  return keyed.sort(({ talk: a, time: left }, { talk: b, time: right }) => {
    if (left === undefined && right !== undefined) return 1;
    if (right === undefined && left !== undefined) return -1;
    if (left !== undefined && right !== undefined && left !== right) {
      return order === 'asc' ? left - right : right - left;
    }
    return compareIds(a.id, b.id);
  }).map(({ talk }) => talk);
}

export function locationLabel(location: Talk['location']): string {
  return typeof location === 'string' ? location : [location?.city, location?.country].filter(Boolean).join(', ');
}

/** "City, Region, Country" splits on the first and last comma; a bare string is the city. */
export function locationParts(location: Talk['location']): { city?: string; country?: string } {
  if (!location) return {};
  if (typeof location !== 'string') {
    const { city, country } = location as { city?: unknown; country?: unknown };
    return { ...(typeof city === 'string' ? { city } : {}), ...(typeof country === 'string' ? { country } : {}) };
  }
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { city: parts[0] };
  return { city: parts[0], country: parts[parts.length - 1] };
}

export type DateStatus = 'upcoming' | 'past' | 'undated';

/** Undated covers missing and invalid dates; without a reference date nothing is upcoming. */
export function classifyTalkDate(value: unknown, referenceDate: unknown): DateStatus {
  if (!parseCalendarDate(value)) return 'undated';
  return isUpcoming(value, referenceDate) ? 'upcoming' : 'past';
}

export function talkYear(value: unknown): number | undefined {
  return parseCalendarDate(value)?.getUTCFullYear();
}

/** NFKD, combining-mark removal, Unicode lowercase, and collapsed whitespace. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function filterTalks<T extends Talk>(talks: readonly T[], options: FilterOptions = {}): T[] {
  const terms = normalizeSearch(options.search ?? '').split(' ').filter(Boolean);
  return talks.filter((talk) => {
    if (options.format && options.format !== 'all' && talk.format !== options.format) return false;
    if (options.recordingOnly && !getTalkLinks(talk).some((link) => link.kind === 'recording')) return false;
    if (options.upcomingOnly && !isUpcoming(talk.date, options.referenceDate)) return false;
    if (options.predicates?.some((predicate) => !predicate(talk))) return false;
    const searchable = normalizeSearch([
      talk.title, talk.event, talk.description, locationLabel(talk.location), ...(talk.tags ?? []),
    ].join(' '));
    return terms.every((term) => searchable.includes(term));
  });
}

/** The year, or range of years, that a newest-first group of dated talks spans in the locale's calendar and digits. */
function localizedYearLabel(entries: readonly Talk[], locale: string): string {
  const formatter = utcFormatter(locale, { year: 'numeric' });
  const newest = parseCalendarDate(entries[0].date)!;
  const oldest = parseCalendarDate(entries[entries.length - 1].date)!;
  return typeof formatter.formatRange === 'function' ? formatter.formatRange(oldest, newest) : formatter.format(newest);
}

export function groupTalks(talks: readonly Talk[], options: GroupOptions = {}): TalkGroup[] {
  const upcomingMode = options.upcoming ?? 'separate';
  const upcoming = upcomingMode === 'none' ? [] : sortTalks(
    talks.filter((talk) => isUpcoming(talk.date, options.referenceDate)), 'asc',
  );
  const years = new Map<string, Talk[]>();
  const undated: Talk[] = [];
  for (const talk of sortTalks(talks)) {
    if (upcomingMode === 'separate' && isUpcoming(talk.date, options.referenceDate)) continue;
    const date = parseCalendarDate(talk.date);
    if (!date) { undated.push(talk); continue; }
    const year = String(date.getUTCFullYear());
    const bucket = years.get(year);
    if (bucket) bucket.push(talk);
    else years.set(year, [talk]);
  }
  const groups: TalkGroup[] = [];
  if (upcoming.length) groups.push({ id: 'upcoming', label: options.upcomingLabel ?? 'Upcoming', talks: upcoming });
  for (const [year, entries] of [...years].sort(([a], [b]) => Number(b) - Number(a))) {
    const label = options.locale === undefined ? year : localizedYearLabel(entries, options.locale);
    groups.push({ id: `year-${year}`, label, talks: entries });
  }
  if (undated.length) groups.push({ id: 'undated', label: options.undatedLabel ?? 'Undated', talks: undated });
  return groups;
}

/** Safe absolute web/contact URLs; relative paths are opt-in for internal details. */
export function safeUrl(value: unknown, options: { allowRelative?: boolean } = {}): string | undefined {
  if (typeof value !== 'string' || !value || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return undefined;
  if (options.allowRelative && /^(?:\/(?!\/)|\.{1,2}\/|#|\?)/.test(value)) return value;
  try {
    const parsed = new URL(value);
    // Require the `//` authority marker: an href like `https:host/x` resolves against the page on a same-scheme site.
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && /^https?:\/\//i.test(value) && parsed.hostname && !parsed.username && !parsed.password) return value;
    if ((parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') && parsed.pathname) return value;
  } catch { /* The caller receives a missing link; validators explain the cause. */ }
  return undefined;
}

const linkFields = [
  ['detailUrl', 'detail'], ['recordingUrl', 'recording'], ['slidesUrl', 'slides'], ['eventUrl', 'event'],
] as const;
const linkKinds: readonly LinkKind[] = ['event', 'recording', 'slides', 'detail', 'general'];
/** Action ids reserved for the link kinds themselves and the generated `${kind}-${index}` ids. */
const RESERVED_LINK_ID = /^(?:event|recording|slides|detail|general)(?:-\d+)?$/;

/** Dedicated fields come first. Distinct semantic kinds are retained even for the same URL. */
export function getTalkLinks(talk: Talk): TalkLink[] {
  const candidates: TalkLink[] = linkFields.flatMap(([field, kind]) =>
    talk[field] ? [{ kind, url: talk[field] as string }] : [],
  );
  candidates.push(...(Array.isArray(talk.links) ? talk.links : []));
  const seen = new Set<string>();
  return candidates.flatMap((link) => {
    if (!link || !linkKinds.includes(link.kind)) return [];
    const url = safeUrl(link.url, { allowRelative: link.kind === 'detail' });
    const key = `${link.kind}\u0000${url}`;
    if (!url || seen.has(key)) return [];
    seen.add(key);
    return [{ ...link, url }];
  });
}

export const DEFAULT_PRIMARY_LINK_PRECEDENCE: readonly LinkKind[] = ['detail', 'event', 'recording', 'slides', 'general'];

/** The first safe link in precedence order; used for a talk's title link and ItemList URLs. */
export function getPrimaryLink(talk: Talk, precedence: readonly LinkKind[] = DEFAULT_PRIMARY_LINK_PRECEDENCE): TalkLink | undefined {
  const links = getTalkLinks(talk);
  for (const kind of precedence) {
    const match = links.find((link) => link.kind === kind);
    if (match) return match;
  }
  return undefined;
}

export function validCoordinates(value: unknown): value is Coordinates {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 90
    && typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 180;
}

export function resolveTalkCoordinates(talk: Talk, options: GeographyOptions = {}): Coordinates | undefined {
  if (talk.format === 'online') return undefined;
  const value = talk.coordinates ?? options.resolveCoordinates?.(talk);
  return validCoordinates(value) ? value : undefined;
}

/** Great-circle kilometers, naturally handling locations on either side of ±180°. */
export function geographicDistanceKm(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180;
  const halfLat = Math.sin((b[0] - a[0]) * radians / 2);
  const halfLng = Math.sin((b[1] - a[1]) * radians / 2);
  const haversine = halfLat ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * halfLng ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

export function deriveGeography(talks: readonly Talk[], options: GeographyOptions = {}): Geography {
  const mergeDistanceKm = options.mergeDistanceKm ?? 64;
  if (!Number.isFinite(mergeDistanceKm) || mergeDistanceKm < 0) throw new RangeError('mergeDistanceKm must be a finite nonnegative number.');
  const mappedTalks: Talk[] = [];
  const markers: GlobeMarker[] = [];
  const regionCounts = new Map<string, number>();
  // Stable ID hosts the first marker; nearest existing host wins, then stable host ID.
  for (const talk of [...talks].sort((a, b) => compareIds(a.id, b.id))) {
    const coordinates = resolveTalkCoordinates(talk, options);
    if (!coordinates) continue;
    mappedTalks.push(talk);
    if (options.assignRegion) {
      const assigned = options.assignRegion(talk, coordinates);
      const region = assigned || (options.unassignedRegion === undefined ? 'Unassigned' : options.unassignedRegion);
      if (region !== null) regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    }
    const nearest = markers.map((marker) => ({ marker, distance: geographicDistanceKm(marker.coordinates, coordinates) }))
      .filter(({ distance }) => distance <= mergeDistanceKm)
      .sort((a, b) => a.distance - b.distance || compareIds(a.marker.id, b.marker.id))[0]?.marker;
    if (nearest) {
      nearest.talks.push(talk);
      nearest.count += 1;
      nearest.latestTalk = sortTalks([nearest.latestTalk, talk])[0];
    } else {
      markers.push({ id: talk.id, coordinates, label: locationLabel(talk.location) || `${coordinates[0]}, ${coordinates[1]}`, count: 1, talks: [talk], latestTalk: talk });
    }
  }
  return {
    mappedTalks,
    mappedCount: mappedTalks.length,
    markers,
    regions: [...regionCounts].sort(([a], [b]) => compareIds(a, b)).map(([id, count]) => ({ id, count, percentage: mappedTalks.length ? count / mappedTalks.length * 100 : 0 })),
  };
}

/** Validates unknown input and produces a safe projection; never mutates source data. */
export function validateTalks(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const result: ValidationResult = { talks: [], errors: [], warnings: [], valid: true };
  if (!Array.isArray(input)) {
    return { ...result, valid: false, errors: [{ index: -1, field: 'talks', code: 'invalid_type', message: 'Expected an array of talks.' }] };
  }
  const ids = new Set<string>();
  // Array.from turns holes into undefined, so a sparse entry is diagnosed instead of skipped.
  Array.from(input).forEach((entry: unknown, index) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const talkId = typeof source.id === 'string' ? source.id : undefined;
    const error = (field: string, code: string, message: string) => { result.errors.push({ index, talkId, field, code, message }); };
    const warning = (field: string, code: string, message: string) => { result.warnings.push({ index, talkId, field, code, message }); };
    const missingIdentity = ['id', 'title', 'event'].filter((key) => typeof source[key] !== 'string' || !(source[key] as string).trim());
    for (const key of missingIdentity) error(key, 'required', `A nonempty ${key} string is required.`);
    if (missingIdentity.length) return;
    const id = source.id as string;
    // Ids become DOM ids and aria-controls IDREFs, where any whitespace splits the reference.
    if (/\s/u.test(id)) { error('id', 'invalid_id', 'An ID must not contain whitespace.'); return; }
    if (ids.has(id)) { error('id', 'duplicate_id', `Duplicate ID ${id}; lenient mode retains the first usable occurrence.`); return; }
    ids.add(id);
    if (!parseCalendarDate(source.date)) error('date', 'invalid_date', 'Expected a real calendar date in YYYY-MM-DD format.');
    if (typeof source.description !== 'string') error('description', 'required', 'A description string is required.');
    const format = source.format;
    if (format !== 'online' && format !== 'in-person' && format !== 'hybrid') error('format', 'invalid_format', 'Expected in-person, online, or hybrid; lenient mode defaults to online.');
    const talk: Talk = {
      id, title: source.title as string, event: source.event as string,
      date: parseCalendarDate(source.date) ? source.date as string : '',
      description: typeof source.description === 'string' ? source.description : '',
      format: format === 'in-person' || format === 'hybrid' ? format : 'online',
    };
    if (typeof source.location === 'string' && source.location.trim()) talk.location = source.location;
    else if (source.location && typeof source.location === 'object') {
      const location = source.location as Record<string, unknown>;
      if (typeof location.city === 'string' && typeof location.country === 'string' && (location.city.trim() || location.country.trim())) talk.location = { city: location.city, country: location.country };
      else warning('location', 'invalid_location', 'Expected a string or an object containing city and country strings, not both blank.');
    } else if (source.location !== undefined) warning('location', 'invalid_location', 'Expected a nonblank string or a city/country object.');
    if (source.coordinates !== undefined) {
      if (validCoordinates(source.coordinates)) talk.coordinates = [...source.coordinates];
      else error('coordinates', 'invalid_coordinates', 'Expected finite latitude [-90, 90] and longitude [-180, 180].');
    }
    for (const [field, kind] of linkFields) {
      if (source[field] === undefined) continue;
      const url = safeUrl(source[field], { allowRelative: kind === 'detail' });
      if (url) talk[field] = url;
      else warning(field, 'invalid_url', 'URL is malformed, contains literal whitespace, or uses a disallowed scheme.');
    }
    if (source.links !== undefined && !Array.isArray(source.links)) warning('links', 'invalid_links', 'Expected an array of typed links.');
    if (Array.isArray(source.links)) {
      const links: TalkLink[] = [];
      const linkIds = new Set<string>();
      Array.from(source.links).forEach((item: unknown, linkIndex: number) => {
        const field = `links[${linkIndex}]`;
        if (!item || typeof item !== 'object') { warning(field, 'invalid_link', 'Expected an object with a link kind and URL.'); return; }
        const link = item as Record<string, unknown>;
        if (!linkKinds.includes(link.kind as LinkKind)) { warning(`${field}.kind`, 'invalid_link_kind', 'Expected event, recording, slides, detail, or general.'); return; }
        const kind = link.kind as LinkKind;
        const url = safeUrl(link.url, { allowRelative: kind === 'detail' });
        if (!url) { warning(`${field}.url`, 'invalid_url', 'URL is malformed, contains literal whitespace, or uses a disallowed scheme.'); return; }
        let linkId: string | undefined;
        if (typeof link.id === 'string') {
          // Link ids become action ids and React keys next to the generated `${kind}-${n}` ids and plugin actions.
          if (!link.id || /\s/u.test(link.id) || RESERVED_LINK_ID.test(link.id)) {
            warning(`${field}.id`, 'invalid_link_id', 'Link ids must be nonempty, contain no whitespace, and not reuse a link kind or a generated kind-index id; the id was dropped.');
          } else if (linkIds.has(link.id)) {
            warning(`${field}.id`, 'invalid_link_id', `Duplicate link id ${link.id} within one talk; the id was dropped.`);
          } else {
            linkId = link.id;
          }
        } else if (link.id !== undefined) {
          warning(`${field}.id`, 'invalid_link_id', 'Link ids must be strings; the id was dropped.');
        }
        if (linkId !== undefined) linkIds.add(linkId);
        // A blank label would leave an icon-only action whose accessible name has no action text.
        const label = typeof link.label === 'string' && link.label.trim() ? link.label : undefined;
        if (label === undefined && link.label !== undefined) warning(`${field}.label`, 'invalid_link_label', 'Link labels must be nonblank strings; the default action label is used.');
        links.push({ kind, url, ...(linkId !== undefined ? { id: linkId } : {}), ...(label !== undefined ? { label } : {}) });
      });
      talk.links = links;
    }
    if (Array.isArray(source.tags)) talk.tags = source.tags.filter((tag): tag is string => typeof tag === 'string');
    else if (source.tags !== undefined) warning('tags', 'invalid_tags', 'Expected an array of strings.');
    result.talks.push(talk);
  });
  result.valid = result.errors.length === 0;
  if ((options.mode ?? 'strict') === 'strict' && !result.valid) result.talks = [];
  return result;
}
