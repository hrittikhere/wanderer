# Configuration

Every option of `<Talks>` from `@wanderer/talks`. Types come from `TalksProps` in the package declarations. Defaults are the values the component applies when the prop is omitted.

## Props

### Data

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `talks` | `readonly Talk[] \| readonly unknown[]` | required | Validated with `validateTalks` in the mode set by `validation`. The result is memoized on the array identity, so pass a stable reference. |
| `referenceDate` | `string` | `undefined` | ISO calendar date `YYYY-MM-DD`, interpreted in UTC. Drives upcoming classification, the `upcoming` filter and the Upcoming group. See [Reference date](#reference-date). |
| `validation` | `'strict' \| 'lenient'` | `'lenient'` | `strict` renders an error state when the data has any error. `lenient` keeps every usable talk. See [Validation](#validation). |
| `onValidation` | `(result: ValidationResult) => void` | `undefined` | Called from an effect whenever the validation result changes. Use it to log warnings. |

### Extensions

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `plugins` | `readonly TalksPlugin[]` | `[]` | Registered per instance. See [plugins.md](plugins.md). |
| `views` | `readonly ViewContribution[]` | `[]` | Extra views beside the built-in list, for example `globeView()`. A view with id `list` replaces the built-in list. |
| `enabledViews` | `readonly string[]` | `undefined` (all) | Keeps only the listed view ids. Registry order is preserved. |
| `slots` | `TalksSlots` | `undefined` | `SearchInput`, `GlobeOverlayCard`, `GlobeAside`, `GlobeStageOverlay`. Slots from props win over plugin slots. See [plugins.md](plugins.md#slots). |
| `milestones` | `readonly Milestone[]` | `[]` | Callouts on the globe. A milestone anchors at `coordinates`, or at the coordinates of the talk named by `talkId`. Milestones that resolve no coordinates are dropped. |
| `ImageComponent` | `ComponentType<ImageComponentProps>` | a plain `<img loading="lazy" decoding="async">` | Renders milestone images. Pass `next/image` or similar. |
| `navigation` | `NavigationOptions` | `{}` | `LinkComponent`, `linkComponentKinds`, `onNavigate`, `policies`, `primaryLink`. See [links.md](links.md). |
| `geography` | `GeographyOptions` | `undefined` | `resolveCoordinates`, `mergeDistanceKm` (64), `assignRegion`, `unassignedRegion`. Inside the component `unassignedRegion` defaults to `copy.unassignedRegion` (`"Other"`); the bare helper defaults to `"Unassigned"`. Geography is derived from the filtered talks, so search and filters change the globe. Markers are merged once from all talks, so a location keeps its marker id, coordinates and label while search and filters narrow its talks. A marker is labeled by its host (lowest id) talk's location, or by the first merged talk with a location when the host has none. |

### View state

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `defaultView` | `string` | `undefined` (first view) | Uncontrolled starting view. Ignored when `responsive` is supplied. |
| `responsive` | `{ breakpoint?: number; small: string; large: string }` | `undefined` | Picks `large` at and above `breakpoint` (default `DEFAULT_BREAKPOINT`, 1024 CSS pixels) and `small` below it, until the user chooses a view. The value is exposed as `context.breakpoint`. See [Responsive behavior](#responsive-behavior). |
| `view` | `string` | `undefined` | Controlled view id. When set, the component never changes the view itself; it reports requests through `onViewChange`. |
| `onViewChange` | `(view: string, change: ViewChange) => void` | `undefined` | `change.reason` is a `ViewChangeReason`; `change.previousView` is the previous id or `undefined`. |
| `escapeToList` | `boolean` | `true` | Escape pressed inside the root switches to the view with id `list`. Skipped when the event is already default-prevented, when `isModalOpen()` returns true, when focus is in an input that still has a value (so the search field clears first), when the list is already active, or when no `list` view exists. |
| `trackpadGestures` | `boolean` | `false` | Horizontal trackpad swipes cycle through the views in registry order. A swipe needs at least 4 pixels of horizontal delta that exceeds the vertical delta, accumulates to 110 pixels, then waits 700 ms before the next switch. RTL inverts the direction. Scrolling is never prevented. Disabled before hydration measures the viewport and when fewer than two views exist. |
| `isModalOpen` | `() => boolean` | `undefined` | Lets a consumer-owned dialog veto the Escape and trackpad shortcuts. |

### Search and filters

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `search` | `string` | `undefined` | Controlled search text. |
| `defaultSearch` | `string` | `''` | Uncontrolled starting search text. |
| `onSearchChange` | `(search: string) => void` | `undefined` | Fires on every change in both modes. |
| `filters` | `readonly FilterId[]` | `undefined` | Controlled active filter ids. |
| `defaultFilters` | `readonly FilterId[]` | `[]` | Uncontrolled starting filter ids. |
| `onFiltersChange` | `(filters: readonly FilterId[]) => void` | `undefined` | Fires on every change in both modes. |
| `builtinFilters` | `readonly BuiltinFilterId[]` | `['recording', 'upcoming']` | Which built-in chips to offer, from `recording`, `upcoming`, `online`, `in-person`, `hybrid`. Unknown ids are ignored and duplicates collapse. Chips render in order `recording` (0), `upcoming` (1), `online` (2), `in-person` (3), `hybrid` (4), interleaved with plugin filters by `order`. |
| `grouping` | `'separate' \| 'duplicate' \| 'none'` | `'separate'` | See [Grouping modes](#grouping-modes). |

### Presentation

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `copy` | `Partial<TalksCopy>` | `undefined` | Overrides merged over the English defaults. Keys set to `undefined` are ignored. See [Copy](#copy). |
| `locale` | `string` | `'en-US'` | Passed to `Intl.DateTimeFormat` for card dates, year group headings and the globe's Latest year. See [Localization](#localization). |
| `dateFormat` | `Intl.DateTimeFormatOptions` | `{ year: 'numeric', month: 'short', day: 'numeric' }` | Format of the full date on a talk card. Always formatted in UTC. The bare `formatCalendarDate` helper defaults to `month: 'long'` instead. |
| `direction` | `'ltr' \| 'rtl'` | `'ltr'` | Sets `dir` on the root. Layout uses logical properties. |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | Sets `data-wanderer-theme` on the root. `system` is light on the server and during hydration. After hydration it follows an ancestor `data-wanderer-scheme` hint when one exists, otherwise `prefers-color-scheme`. See [styling.md](styling.md#dark-mode). |
| `tokens` | `ThemeTokens` | `undefined` | Inline `--wanderer-*` custom properties on the root. |
| `className` | `string` | `undefined` | Appended to the root `class` after `wanderer`. |
| `style` | `CSSProperties` | `undefined` | Inline style on the root, merged after `tokens` so it wins on a collision. |
| `density` | `'comfortable' \| 'compact'` | `'comfortable'` | Sets `data-wanderer-density`. `compact` hides talk descriptions, tightens card padding and shrinks the title. |
| `headingLevel` | `1 \| 2 \| 3 \| 4` | `2` | Level of the view headings. Group headings, the globe panel heading and the globe section headings use the next level. Talk titles use two levels down. Levels clamp to `h6`. |
| `viewHeadings` | `'visible' \| 'visually-hidden'` | `'visible'` | `visually-hidden` keeps the view headings in the DOM as focus targets and shows them only while focused. |

## Controlled and uncontrolled state

View, search and filters are controlled independently. Each becomes controlled when its value prop is not `undefined`.

View precedence, highest first:

1. `view` prop (controlled).
2. The user's explicit choice inside the component (toggle, Escape, trackpad, a plugin calling `setView`).
3. The responsive default from `responsive`.
4. `defaultView`, then the first registered view.

When the resolved view is not among the registered ids, the first registered view is shown and `onViewChange` reports `unavailable`.

In controlled mode, a switch requested inside the component calls `onViewChange(next, { reason, previousView })` once and does not change the view itself. Change the `view` prop to accept it. After the first resolution, your own prop changes are not echoed back; the only other report in controlled mode is an `unavailable` fallback.

Search and filters use the same rule: controlled when `search` or `filters` is defined, otherwise internal state seeded from `defaultSearch` or `defaultFilters`. `onSearchChange` and `onFiltersChange` fire in both modes. Do not switch a prop between `undefined` and a value during the component's life.

The context exposes `setView(id, reason?)`, `setSearch`, `setFilters`, `toggleFilter` and `resetAll` for plugins. `setView` ignores ids that are not registered.

## ViewChangeReason

| Reason | When |
|---|---|
| `initial` | The first resolution after hydration in uncontrolled mode, including the first responsive pick. Also reported when a `defaultView` or `enabledViews` change re-resolves the default without a breakpoint crossing or a user choice. |
| `user` | An explicit action inside the component: a view button, Escape, a trackpad swipe, the globe's "Open the list" or "Back to the list" buttons, or `setView(id)` without a reason. Focus moves to the active view's heading. |
| `responsive` | The breakpoint crossed and the user had not chosen a view. |
| `unavailable` | The requested view is disabled or missing, so the first registered view is shown. |
| `controlled` | The first resolution while the `view` prop is set. Later prop changes are not reported; requests from inside the component arrive with their own reason. |

## Responsive behavior

With `responsive` set:

- On the server and during the first hydration render, the viewport width is unknown. The component renders two shells, `.wanderer-shell--small` and `.wanderer-shell--large`, each with its own toolbar and view. The root carries `data-wanderer-breakpoint`, `data-wanderer-view-small` and `data-wanderer-view-large`, and `data-wanderer-view` is absent.
- The stylesheet hides one shell per breakpoint for the default 1024 pixel breakpoint. For a custom breakpoint the component emits a small inline `<style>` scoped to the instance.
- Views receive `active={false}` while both shells render, so the globe does not start loading until the viewport is measured.
- After measurement a single `.wanderer-shell--active` remains and `data-wanderer-view` is set.
- The media query is watched. Crossing the breakpoint changes the view with reason `responsive` only while the user has not chosen a view. An explicit choice is kept across breakpoint changes for the life of the instance.
- If `small` or `large` names a view that is not registered, the first registered view is used for that shell.

Without `responsive`, `defaultView` (or the first view) renders in one shell from the first render.

## Reference date

- Upcoming classification never reads the current date; only globe animation uses a clock. If you omit `referenceDate` or pass one that is not a real calendar date, nothing is upcoming: no Upcoming group is produced, the `upcoming` filter matches nothing and no badge shows.
- A talk dated the same day as `referenceDate` is upcoming. Comparison is on UTC calendar dates.
- Invalid or missing talk dates are `undated`, never upcoming.
- `classifyTalkDate(date, referenceDate)` from `@wanderer/talks/helpers` returns `'upcoming' | 'past' | 'undated'` with the same rules.

In a client-only app, compute the date once at startup: `new Date().toISOString().slice(0, 10)`.

In Next.js with Cache Components, reading the clock during prerender is a build error. Compute it in a cached scope and pass it down:

```tsx
import { cacheLife } from 'next/cache';

async function getReferenceDate(): Promise<string> {
  'use cache';
  cacheLife('hours');
  return new Date().toISOString().slice(0, 10);
}
```

The snapshot is taken when the cache entry is filled and refreshes when the entry revalidates on the `hours` profile. A fully static export keeps the build-time value until the next build.

## Grouping modes

`groupTalks` produces groups with ids `upcoming`, `year-YYYY` and `undated`. Group labels come from `copy.upcoming` and `copy.undated`. Year group ids always use the Gregorian year. The component labels year groups with the year formatted in `locale` (see [Localization](#localization)); the bare helper labels them with the Gregorian year number unless you pass its `locale` option.

| Mode | Upcoming group | Year groups |
|---|---|---|
| `separate` (default) | Present when at least one talk is upcoming, sorted ascending by date. | Exclude upcoming talks. |
| `duplicate` | Present when at least one talk is upcoming, sorted ascending. | Include upcoming talks as well. |
| `none` | Absent. | Include every dated talk. |

Year groups are ordered newest first, talks within a year newest first. Ties sort by id with code-point comparison. Undated talks go last. The Upcoming group renders as a card grid; other groups render as a divided list.

Empty groups are omitted. The component groups the talks that match the current search and filters, so `context.groups` holds only groups with at least one matching talk. Find the Upcoming group by id rather than by position.

## Search

Search text and every searched field are normalized with `normalizeSearch`: NFKD, combining marks removed, Unicode lowercase, whitespace collapsed and trimmed. The query splits on spaces into terms; a talk matches when every term is a substring of the normalized concatenation of:

- `title`
- `event`
- `description`
- `locationLabel(location)` (the string, or `city, country`)
- each entry of `tags`

Active filters are applied as predicates on the same pass. The toolbar count uses `copy.resultCount(matching, total)`. A polite live region announces that count 600 ms after the last change, only while search text or a filter is active.

### Large histories

The search field and filter chips update immediately; filtering, grouping and re-rendering the list follow in a deferred render (`useDeferredValue`), which React interrupts when the next keystroke arrives, so typing stays responsive with long lists. Globe markers are merged once from all talks (in time proportional to the number of talks), and each search or filter only narrows that result. The list renders every matching talk and has no virtualization: a few hundred talks render in tens of milliseconds, while several thousand produce megabytes of server HTML and a noticeable first render. For histories that large, paginate or window the list in a custom view (see [plugins.md](plugins.md)), or pass a pre-filtered `talks` array.

## Validation

`validateTalks(input, { mode })` from `@wanderer/talks/helpers` checks unknown input and returns `{ talks, errors, warnings, valid }`. The helper defaults to `strict`; the component defaults to `lenient`.

Errors (reject in strict mode):

- `talks` is not an array (`invalid_type`).
- `id`, `title` or `event` missing, not a string, or blank (`required`). The entry is dropped in both modes.
- Duplicate `id` (`duplicate_id`). Later occurrences are dropped in both modes.
- `id` containing whitespace (`invalid_id`). The entry is dropped in both modes because ids become DOM ids and IDREFs.
- `date` not a real `YYYY-MM-DD` calendar date (`invalid_date`). Lenient keeps the talk as undated.
- `description` not a string (`required`). Lenient uses an empty string.
- `format` not `in-person`, `online` or `hybrid` (`invalid_format`). Lenient defaults to `online`.
- `coordinates` present but not a finite `[lat, lng]` within range (`invalid_coordinates`). Lenient keeps the talk without coordinates.

Warnings (never reject):

- `location` that is neither a string nor a `{ city, country }` object, or is blank: an empty or whitespace-only string, or an object whose `city` and `country` are both blank (`invalid_location`); the field is dropped.
- `eventUrl`, `recordingUrl`, `slidesUrl`, `detailUrl` that is malformed, contains whitespace or control characters, or uses a scheme other than `http`, `https`, `mailto` or `tel` (`invalid_url`); the field is dropped. `detailUrl` may also be a relative path.
- A `links[].id` that is not a string, is empty, contains whitespace, reuses a link kind or a generated `kind-n` id, or repeats within the talk (`invalid_link_id`). The id is dropped and the link is kept.
- A `links[].label` that is not a string or is blank (`invalid_link_label`). The label is dropped, the link is kept, and its action uses `copy.<kind>Action`.
- `links` not an array (`invalid_links`), an entry that is not an object (`invalid_link`), an unknown `kind` (`invalid_link_kind`), or an unsafe `url` (`invalid_url`); the entry is dropped.
- `tags` not an array (`invalid_tags`); the field is dropped. Non-string entries inside the array are dropped without a warning.

The result is a projection: keys outside the `Talk` schema (for example `category` or `image`) are dropped without a diagnostic. `<Talks>` validates its `talks` prop, so plugins, renderers and filters only ever see schema fields. Keep site-only data in a map keyed by `id`; see [migration.md](migration.md#site-only-fields).

With `validation="strict"` on the component and any error, the root renders `<section class="wanderer wanderer--error" role="alert">` with `copy.validationError` and nothing else. With `lenient`, the usable talks render and `onValidation` receives the diagnostics.

## Copy

Every string and label other than formatted dates is a key of `TalksCopy`. Pass `copy={{ ... }}` with any subset. `createDefaultCopy()` and `mergeCopy(overrides)` are exported for building full tables.

| Key | Default |
|---|---|
| `rootLabel` | `Talks` |
| `viewsLabel` | `View` |
| `listView` | `List` |
| `globeView` | `Globe` |
| `listHeading` | `All talks` |
| `globeHeading` | `Talks on the map` |
| `searchLabel` | `Search talks` |
| `searchPlaceholder` | `Search titles, events, locations` |
| `clearSearch` | `Clear search` |
| `filtersLabel` | `Filters` |
| `recordingFilter` | `With recording` |
| `upcomingFilter` | `Upcoming only` |
| `onlineFilter` | `Online` |
| `inPersonFilter` | `In person` |
| `hybridFilter` | `Hybrid` |
| `clearFilters` | `Clear filters` |
| `resetAll` | `Reset search and filters` |
| `upcoming` | `Upcoming` |
| `upcomingBadge` | `Upcoming` |
| `undated` | `Undated` |
| `undatedMonth` | `–` (en dash) |
| `noTalks` | `No talks yet` |
| `noTalksDescription` | `Talks will appear here once they are added.` |
| `noMatches` | `No talks match` |
| `noMatchesDescription` | `Try a different search or clear the filters.` |
| `loadingGlobe` | `Loading the globe` |
| `globeUnavailable` | `The globe could not be shown` |
| `globeUnavailableDescription` | `Your browser may not support WebGL, or the globe module failed to load. Everything is in the list.` |
| `noMappedTalks` | `No talks on the map` |
| `noMappedDescription` | `Add coordinates to talks, or supply a coordinate resolver, to place them on the globe.` |
| `useList` | `Open the list` |
| `exitFullscreen` | `Exit fullscreen` |
| `backToList` | `Back to the list` |
| `regions` | `Regions` |
| `locations` | `Locations` |
| `unassignedRegion` | `Other` |
| `unknownLocation` | `Unknown location` |
| `globeLabel` | `Interactive globe of talk locations` |
| `globeHint` | `Drag to rotate. Hover a marker for details.` |
| `milestones` | `Milestones` |
| `chooseMilestone` | `Choose a milestone` |
| `pauseGlobe` | `Pause animation` |
| `resumeGlobe` | `Resume animation` |
| `dismissMilestone` | `Dismiss milestone` |
| `viewMilestoneImage` | `View full photo` |
| `latest` | `Latest` |
| `eventAction` | `Event page` |
| `recordingAction` | `Watch recording` |
| `slidesAction` | `Slides` |
| `detailAction` | `Details` |
| `generalAction` | `Link` |
| `online` | `Online` |
| `inPerson` | `In person` |
| `hybrid` | `Hybrid` |
| `validationError` | `The talks could not be displayed because the data is invalid.` |
| `pluginError` | `This part of the page failed to render.` |

Function keys receive numbers or raw strings, never preformatted text:

| Key | Signature | Default output |
|---|---|---|
| `resultCount` | `(count, total) => string` | `12 talks` when equal, otherwise `3 of 12 talks` (`1 talk` singular) |
| `groupCount` | `(count) => string` | `5 talks` / `1 talk` |
| `mappedCount` | `(mapped, locations) => string` | `40 talks in 18 locations` (singulars handled) |
| `locationCount` | `(count) => string` | `3 talks` / `1 talk` |
| `regionPercentage` | `(percentage) => string` | `42.9%` (one decimal) |
| `actionLabel` | `(action, title) => string` | `Watch recording: Talk title` |

`undated` doubles as the formatted value for a talk without a valid date. `undatedMonth` fills the card margin where a dated talk shows its month abbreviation. `upcoming` is the group label; `upcomingBadge` is the badge on a card.

## Localization

- `locale` and `dateFormat` feed `Intl.DateTimeFormat` with `timeZone: 'UTC'` forced, so a calendar date never shifts by a day.
- The month abbreviation in the card margin is formatted with `{ month: 'short' }` in the same locale.
- Year group headings and the globe's Latest year are formatted with `{ year: 'numeric' }` in the same locale, so they use the locale's calendar and digits like the card dates: `2030年` in `ja-JP`, `พ.ศ. 2573` in `th-TH`, `٢٠٣٠` in `ar-EG`. When the talks in one Gregorian year fall in two years of the locale's calendar (for example `fa-IR`), the heading shows that range.
- `direction="rtl"` sets `dir="rtl"` on the root. The stylesheet uses logical properties and mirrors the globe callout placement.
- `copy` carries every other string. Build a full table with `mergeCopy` when you localize once and reuse it.

## Density, heading levels and view headings

- `density="compact"` sets `data-wanderer-density="compact"`. Descriptions are not rendered, card padding shrinks and titles drop to 1rem.
- `headingLevel` sets the outline: view heading at `headingLevel`, groups and globe sections at `headingLevel + 1`, talk titles at `headingLevel + 2`. The default of 2 assumes the host page owns the `h1`.
- `viewHeadings="visually-hidden"` adds `wanderer-visually-hidden wanderer-visually-hidden--focusable` to the view heading. It stays in the DOM with `tabindex="-1"` and receives focus on user-initiated view switches, so screen reader users still hear the view name.
