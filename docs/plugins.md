# Plugins

A plugin is a plain object passed through the `plugins` prop. It contributes views, filters, actions, renderers and slots to one `<Talks>` instance. There are no global registries; two instances on a page can use different plugins.

```ts
import type { TalksPlugin } from '@wanderer/talks';

export const myPlugin: TalksPlugin = {
  id: 'my-plugin',
  order: 0,
  views: [],
  filters: [],
  actions: [],
  renderers: [],
  slots: {},
};
```

Every array is optional. Either annotate the literal with `TalksPlugin` or pass it to `definePlugin(plugin)`. `definePlugin` is an identity function typed `<T extends TalksPlugin>(plugin: T) => T`, so an unannotated literal gets contextual types for callback parameters such as `talk` and `context` and the inferred type keeps the literal's exact shape. It is exported from `@wanderer/talks` and from `@wanderer/talks/helpers`, so a plugin module can stay free of client modules.

## TalksPlugin

```ts
interface TalksPlugin {
  id: string;
  order?: number;
  views?: readonly ViewContribution[];
  filters?: readonly FilterContribution[];
  actions?: readonly ActionContribution[];
  renderers?: readonly RendererContribution[];
  slots?: TalksSlots;
}
```

Ids must be nonempty strings with no surrounding whitespace, and view ids must contain no whitespace at all, since they become element ids and `aria-labelledby` references. `order` must be a finite number when present. Every entry of `plugins` (and of each contribution list) must be an object: `[base, flag && extra]` throws a message naming the entry, so filter such arrays first. Empty slots in sparse arrays are rejected just like explicit `undefined` entries.

## Ordering

Plugins sort by `order` (default 0), then by `id` with code-point comparison (never locale-aware). Their contributions are flattened into one namespace per kind and sorted the same way, together with the built-ins. The built-in list view has order 0, `globeView()` has order 10, and the built-in filters have orders 0 to 4. Give a contribution a negative order to place it before the built-ins.

## Reserved ids

| Kind | Reserved ids |
|---|---|
| views | `list`, `globe`, plus the id of every view passed through the `views` prop |
| filters | `recording`, `upcoming`, `online`, `in-person`, `hybrid` (reserved even when `builtinFilters` does not offer them) |
| actions | `event`, `recording`, `slides`, `detail`, `general` |
| renderers | `default` |

A plugin contribution that uses a reserved id, or an id already used by another plugin's contribution of the same kind, throws `Duplicate or reserved plugin/contribution ID: <id>` during render. Two plugins with the same `id` throw the same way. Wrap the component in your own error boundary if you want a softer failure; the library reports misconfiguration loudly on purpose.

## Overrides

- The `views` prop may replace the built-in list by passing a `ViewContribution` with `id: 'list'`. Plugins cannot replace `list` or `globe`.
- Filters, actions and renderers have no override mechanism. Add new ids.
- Slots: a slot set through the `slots` prop wins over any plugin. Among plugins, the first plugin in sorted order that defines a slot wins for that slot; later plugins are ignored for it.

## Contributions

### ViewContribution

```ts
interface ViewContribution {
  id: string;
  order?: number;
  label: string;            // toggle button text; '' falls back to copy for `list` and `globe`
  presentation?: 'inline' | 'immersive'; // fullscreen includes the toolbar and heading
  heading?: string;         // rendered by Talks above the view; defaults to the label (copy.listHeading / copy.globeHeading for `list` and `globe`)
  icon?: ReactNode;         // drawn before the label in the toggle
  Component: ComponentType<TalkViewProps>;
  preload?: () => Promise<unknown>;  // called on pointer enter and focus of the toggle
}

interface TalkViewProps {
  context: TalksContext;
  active: boolean;   // false while both responsive shells render before hydration
  headingId: string; // id of the heading Talks renders above the view
  viewId: string;
  presentation?: 'inline' | 'immersive'; // the presentation in effect: immersive only inside the fullscreen dialog
}
```

The view component renders the body only. `Talks` renders the toolbar and the heading, wraps the body in an error boundary (fallback: `copy.pluginError`) and resets that boundary when the view changes. On the server React does not run error boundaries, so the body also sits in a `<Suspense>` boundary: a view that throws during server rendering leaves an empty placeholder and is rendered again on the client, where the error boundary applies. The body is memoized on `context`, so the render that only updates the search field after a keystroke skips it. Right after hydration the body receives the resolved context (viewport, color scheme, `active`) in a deferred render rather than the urgent one, which lets React 18 hydrate the boundary first; see [SSR](ssr.md#hydration-model).

### FilterContribution

```ts
interface FilterContribution {
  id: string;
  order?: number;
  label: string;
  predicate: (talk: Talk, context: FilterPredicateContext) => boolean;
}

interface FilterPredicateContext {
  referenceDate?: string;
  allTalks: readonly Talk[];
  search: string;
  filters: readonly string[];  // active filter ids
}
```

The chip renders with `aria-pressed`. Active predicates are combined with AND and with the search terms.

### ActionContribution

```ts
interface ActionContribution {
  id: string;
  order?: number;
  label: string | ((talk: Talk) => string);
  when?: (talk: Talk) => boolean;
  getLink?: (talk: Talk) => TalkLink | undefined;
  onAction?: (talk: Talk, context: TalksContext) => void;
  icon?: ReactNode;
}
```

Per talk, `when` is evaluated first. If `getLink` returns a link, the action renders as an anchor through the navigation options (target and rel follow the link's `kind`). Otherwise, when `onAction` is set, it renders as a `<button>` that calls `onAction(talk, context)`. With neither a link nor `onAction`, the action is not rendered for that talk, so `getLink` can return `undefined` to skip a talk. Actions from links on the talk itself render first, then plugin actions in order. The accessible name is `copy.actionLabel(label, talk.title)`. Without `icon`, the default icon is chosen by `kind` (`recording`, `slides`, `detail`, `event` or `general`); a button with no kind has no icon.

The URL returned by `getLink` passes through the same `safeUrl` gate as built-in links. Unsafe links render their label as noninteractive text and never reach a custom router component.

### RendererContribution

```ts
interface RendererContribution {
  id: string;
  order?: number;
  when?: (talk: Talk) => boolean;
  Component: ComponentType<TalkRendererProps>;
}

interface TalkRendererProps {
  talk: Talk;
  context: TalksContext;
  upcoming: boolean;
  group?: TalkGroup;
}
```

For each talk, the first renderer in order whose `when` passes (or that has no `when`) replaces the built-in `TalkCard`. Each custom renderer is wrapped in an error boundary with `copy.pluginError`, and in a `<Suspense>` boundary so a renderer that throws on the server falls back to client rendering for that card instead of failing the page. `context.renderTalk(talk, group)` applies the same resolution, so custom views get custom renderers for free.

### Slots

```ts
interface TalksSlots {
  SearchInput?: ComponentType<SearchSlotProps>;
  GlobeOverlayCard?: ComponentType<GlobeOverlayCardProps>;
  GlobeAside?: ComponentType<GlobeAsideProps>;
  GlobeStageOverlay?: ComponentType<GlobeAsideProps>;
}

interface SearchSlotProps {
  id: string;                 // unique per instance and shell; put it on the input and on your own <label htmlFor> (the shell renders no label for a slot)
  value: string;
  onChange: (value: string) => void;
  label: string;              // copy.searchLabel
  placeholder: string;        // copy.searchPlaceholder
  resultCount: number;
  context: TalksContext;
}

interface GlobeOverlayCardProps { milestone: Milestone; context: TalksContext; }
interface GlobeAsideProps { context: TalksContext; geography: Geography; }
```

`SearchInput` replaces the whole built-in search field, including its clear button. Any text input it renders (`type="search"`, `"text"` and so on) behaves like the built-in one on Escape: the first press clears the search, the next one returns to the list. A text field inside a plugin view keeps Escape while it has text and is never cleared by the component; handle Escape in its own `onKeyDown` if it should clear. `GlobeOverlayCard` replaces the card inside the milestone callout that appears when the renderer activates a milestone; the callout wrapper and its Dismiss button stay, so do not add a close control of your own. `GlobeAside` renders inside the globe panel below the region and location lists. `GlobeStageOverlay` renders in a `<div class="wanderer-globe__overlay">` inside `.wanderer-globe__stage-wrap`, layered over the stage and its hint. The overlay is absolutely positioned over the whole stage area with `pointer-events: none`; its direct children get `pointer-events: auto`, so position your own content and it stays clickable. It receives the same props as `GlobeAside`.

## The context

`useTalks()` from `@wanderer/talks` returns the `TalksContext` of the nearest `<Talks>`. It throws outside one. The same object is passed as `context` to views, renderers, slots and `onAction`.

Useful members:

| Member | Purpose |
|---|---|
| `allTalks`, `talks`, `groups`, `geography` | Validated talks, the filtered subset, the grouped subset, markers and regions. |
| `referenceDate`, `isUpcoming(talk)`, `formatDate(date, options?)` | Date helpers bound to the instance's locale and format. |
| `view`, `views`, `setView(id, reason?)`, `viewHeadingId(id)` | View state. `setView` defaults the reason to `user`, which also moves focus to the heading. |
| `search`, `setSearch`, `filters`, `setFilters`, `toggleFilter`, `availableFilters`, `hasActiveFilters`, `resetAll` | Search and filter state. `search`, `filters` and `hasActiveFilters` describe the applied results and can trail the field by one render while a long list updates; the setters always apply to the latest value and accept a function of it. |
| `getLinks(talk)`, `getPrimaryLink(talk)`, `getActions(talk)`, `renderLink(link, children, talk?, props?)` | The link model, honoring the navigation options. |
| `renderTalk(talk, group?)` | Renders a talk through the renderer resolution. |
| `copy`, `locale`, `dateFormat`, `direction`, `theme`, `colorScheme`, `breakpoint`, `density`, `headingLevel`, `grouping` | Presentation settings. `colorScheme` is `light` on the server and during hydration when `theme` is `system`; after hydration it honors an ancestor `data-wanderer-scheme` hint, then `prefers-color-scheme`. `breakpoint` is the responsive breakpoint in CSS pixels (`DEFAULT_BREAKPOINT`, 1024, without `responsive`); match the shells in a custom view with ``useMediaQuery(`(min-width: ${context.breakpoint}px)`)``. The globe's milestone callout and connector lines do not follow it: they depend on the measured space beside the stage (`data-wanderer-callout`). |
| `instanceId`, `milestones`, `ImageComponent`, `slots`, `navigation`, `geographyOptions`, `validation` | Instance data. |

## State and cleanup

- Plugin components own their state with ordinary hooks. The library stores nothing for them.
- Read everything else from `useTalks()` or the `context` prop; do not reach into DOM of other parts of the component.
- Contributions are registered per instance when the `plugins` prop changes. An inline array is fine when its items are stable (define plugins at module scope or with `useMemo`): a new array with the same plugin objects keeps the registry. A plugin object created during render rebuilds it every time. The same holds for `views`, `enabledViews`, `builtinFilters` and `slots`.
- A filter predicate that throws excludes the talks it threw on and is logged once per filtering pass; a `SearchInput` slot that throws is replaced by `copy.pluginError` while the chips, count and views keep working.
- Subscriptions (timers, observers, event listeners) belong in effects with cleanup. Views unmount when the user switches, and the error boundary resets on view change.
- Server rendering: every contribution renders on the server (a view or renderer that throws there falls back to client rendering). Do not touch `window`, `document`, `matchMedia` or `IntersectionObserver` during render. Use effects, or `useIsClient()` from `@wanderer/talks`, and keep the first client render identical to the server output. Lazy chunks belong in `preload` and in an effect, as `globeView()` does.

## Accessibility expectations

- Keep the heading structure. A custom view renders under the heading `Talks` provides; use `context.headingLevel + 1` for sections inside it (the `Heading` component from `@wanderer/talks/list` clamps to `h1` to `h6`).
- Keep labels. A `SearchInput` must render a `<label>` for the `id` it receives or an `aria-label` equal to `label`. Custom actions get `aria-label` from `copy.actionLabel` only when rendered by the built-in card; a custom renderer must do the same.
- Keyboard operability: every control reachable and operable with Tab, Enter and Space. Do not rely on hover alone; the globe keeps a list equivalent for this reason.
- Touch targets: controls at least 44 by 44 CSS pixels. The `--wanderer-control-height` token is 2.75rem for this reason; reuse the `wanderer-chip`, `wanderer-button` or `wanderer-action` classes.
- No nested interactive controls. Do not put a button inside an anchor or an anchor inside a button. A card that links its title must not also be a link itself.
- Announce state with `aria-pressed`, `aria-expanded` or live regions, not with color alone. Respect `prefers-reduced-motion` through `usePrefersReducedMotion()`.

## Examples

All examples import real exports. They assume `import '@wanderer/talks/styles.css'` once in the app.

### Custom filter

```tsx
import { Talks, type TalksPlugin } from '@wanderer/talks';

const workshops: TalksPlugin = {
  id: 'workshops',
  filters: [
    {
      id: 'workshop',
      order: 5,
      label: 'Workshops',
      predicate: (talk) => talk.tags?.includes('workshop') ?? false,
    },
    {
      id: 'this-year',
      order: 6,
      label: 'This year',
      predicate: (talk, { referenceDate }) =>
        Boolean(referenceDate) && talk.date.slice(0, 4) === referenceDate!.slice(0, 4),
    },
  ],
};

export function Page({ talks, referenceDate }: { talks: unknown[]; referenceDate: string }) {
  return <Talks talks={talks} referenceDate={referenceDate} plugins={[workshops]} />;
}
```

### Custom action as a link

```tsx
import type { TalksPlugin } from '@wanderer/talks';
import { parseCalendarDate } from '@wanderer/talks/helpers';

export const calendar: TalksPlugin = {
  id: 'calendar',
  actions: [
    {
      id: 'add-to-calendar',
      label: 'Add to calendar',
      when: (talk) => parseCalendarDate(talk.date) !== null,
      getLink: (talk) => ({
        kind: 'general',
        url: `https://calendar.example/new?text=${encodeURIComponent(talk.title)}&date=${talk.date}`,
      }),
    },
  ],
};
```

The action opens in a new tab with `rel="noopener noreferrer"` because `general` links do so by default. Override with `navigation.policies.general`.

### Custom action as a button

```tsx
import type { TalksPlugin } from '@wanderer/talks';

export const share: TalksPlugin = {
  id: 'share',
  actions: [
    {
      id: 'copy-link',
      label: 'Copy link',
      when: (talk) => Boolean(talk.detailUrl || talk.eventUrl),
      onAction: (talk, context) => {
        const link = context.getPrimaryLink(talk);
        if (link) void navigator.clipboard.writeText(new URL(link.url, window.location.href).href);
      },
    },
  ],
};
```

### Custom renderer

```tsx
import type { TalkRendererProps, TalksPlugin } from '@wanderer/talks';
import { Heading } from '@wanderer/talks/list';

function OnlineRow({ talk, context, upcoming }: TalkRendererProps) {
  const primary = context.getPrimaryLink(talk);
  return (
    <article className="wanderer-talk" data-wanderer-format={talk.format} data-wanderer-upcoming={upcoming || undefined}>
      <div className="wanderer-talk__body">
        <Heading level={context.headingLevel + 2} className="wanderer-talk__title">
          {primary ? context.renderLink(primary, talk.title, talk, { className: 'wanderer-talk__title-link' }) : talk.title}
        </Heading>
        <p className="wanderer-talk__event">{talk.event} · {context.formatDate(talk.date)}</p>
      </div>
    </article>
  );
}

export const onlineRows: TalksPlugin = {
  id: 'online-rows',
  renderers: [{ id: 'online-row', when: (talk) => talk.format === 'online', Component: OnlineRow }],
};
```

### Custom view

```tsx
import type { TalkViewProps, TalksPlugin } from '@wanderer/talks';
import { EmptyState, Heading } from '@wanderer/talks/list';

function Timeline({ context }: TalkViewProps) {
  const { groups, copy, talks, renderTalk, headingLevel } = context;
  if (talks.length === 0) return <EmptyState title={copy.noMatches} description={copy.noMatchesDescription} />;
  return (
    <ol className="timeline">
      {groups.map((group) => (
        <li key={group.id}>
          <Heading level={headingLevel + 1}>{group.label}</Heading>
          <ul>{group.talks.map((talk) => <li key={talk.id}>{renderTalk(talk, group)}</li>)}</ul>
        </li>
      ))}
    </ol>
  );
}

export const timeline: TalksPlugin = {
  id: 'timeline',
  views: [{ id: 'timeline', order: 5, label: 'Timeline', heading: 'Talks by year', Component: Timeline }],
};
```

Pass it with `plugins={[timeline]}`. The toggle shows List, Timeline, then Globe if `globeView()` is also registered, because orders are 0, 5 and 10.

### SearchInput slot

```tsx
import type { SearchSlotProps, TalksPlugin } from '@wanderer/talks';

function CommandSearch({ id, value, onChange, label, placeholder, resultCount }: SearchSlotProps) {
  return (
    <div className="command-search">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-count`}
      />
      <span id={`${id}-count`}>{resultCount}</span>
    </div>
  );
}

export const commandSearch: TalksPlugin = { id: 'command-search', slots: { SearchInput: CommandSearch } };
```

The same component can be passed directly as `slots={{ SearchInput: CommandSearch }}`, which takes precedence over any plugin.

### GlobeOverlayCard slot

```tsx
import type { GlobeOverlayCardProps, TalksPlugin } from '@wanderer/talks';

function MilestoneCard({ milestone, context }: GlobeOverlayCardProps) {
  const Image = context.ImageComponent;
  return (
    <div className="wanderer-milestone">
      {milestone.image && <Image {...milestone.image} loading="lazy" className="wanderer-milestone__image" />}
      <div className="wanderer-milestone__body">
        <p className="wanderer-milestone__title">{milestone.title}</p>
        {milestone.description && <p className="wanderer-milestone__description">{milestone.description}</p>}
      </div>
    </div>
  );
}

export const milestoneCards: TalksPlugin = { id: 'milestone-cards', slots: { GlobeOverlayCard: MilestoneCard } };
```

The card appears inside `.wanderer-globe__callout` when the renderer sets an active milestone. Pass milestones through the `milestones` prop.

### GlobeAside slot

```tsx
import type { GlobeAsideProps, TalksPlugin } from '@wanderer/talks';
import { Heading } from '@wanderer/talks/list';

function Totals({ context, geography }: GlobeAsideProps) {
  return (
    <section className="wanderer-globe__section">
      <Heading level={context.headingLevel + 1} className="wanderer-globe__section-title">Totals</Heading>
      <p className="wanderer-globe__section-empty">
        {context.copy.mappedCount(geography.mappedCount, geography.markers.length)}
      </p>
    </section>
  );
}

export const totals: TalksPlugin = { id: 'totals', slots: { GlobeAside: Totals } };
```

`geography` reflects the filtered talks, so the aside updates with search and filters.

### GlobeStageOverlay slot

```tsx
import { definePlugin, type GlobeAsideProps } from '@wanderer/talks';

function Legend({ context, geography }: GlobeAsideProps) {
  return (
    <div style={{ position: 'absolute', insetBlockStart: '10%', insetInlineEnd: 0 }}>
      {geography.regions.map((region) => (
        <span key={region.id}>{region.id} {context.copy.regionPercentage(region.percentage)}</span>
      ))}
    </div>
  );
}

export const legend = definePlugin({ id: 'legend', slots: { GlobeStageOverlay: Legend } });
```

The component renders inside `.wanderer-globe__overlay`, which covers the stage area and lets pointer events through except on its direct children. Position the content yourself; the library does not place it. Use it for content that must float over the globe, such as a legend or a contact card, and `GlobeAside` for content that belongs in the scrolling panel.
