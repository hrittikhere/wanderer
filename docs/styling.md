# Styling

The stylesheet at `@wanderer/talks/styles.css` is plain CSS scoped to `.wanderer`. It sets no global element styles. Colors, type, spacing, radii, shadows, motion and globe colors are custom properties you can override.

```ts
import '@wanderer/talks/styles.css';
```

## Tokens

All tokens are defined on `.wanderer`. The dark column applies for `data-wanderer-theme="dark"`, for `system` under `prefers-color-scheme: dark`, and for `system` under a `data-wanderer-scheme="dark"` ancestor. Tokens with one value do not change between palettes.

### Surfaces

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-bg` | `#ffffff` | `#09090b` | Base background reference; focus ring offset color. |
| `--wanderer-surface` | `#f7f7f8` | `#141417` | Error box background, globe loading disc. |
| `--wanderer-surface-raised` | `#ffffff` | `#1c1c21` | Globe tooltip and milestone card background. |
| `--wanderer-surface-muted` | `#efeff2` | `#232329` | Muted badge background, milestone media placeholder, loading disc. |

### Text

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-text` | `#18181b` | `#f4f4f5` | Body text, tooltips, back button. |
| `--wanderer-text-muted` | `#4b4b55` | `#c6c6cf` | Event line, description, empty state description, location buttons. |
| `--wanderer-text-subtle` | `#6b6b76` | `#a2a2ad` | Counts, meta rows, placeholders, icons, hints. |

### Borders

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-border` | `#e4e4e7` | `#2a2a31` | Group dividers, list item separators, tooltip sections, globe summary. |
| `--wanderer-border-strong` | `#c9c9d1` | `#42424c` | Hover borders, empty state dashed border, error box border. |

### Accent

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-accent` | `#1f5ed6` | `#7fb0ff` | Links, link buttons, upcoming badge and dot, error accent bar, milestone title. |
| `--wanderer-accent-hover` | `#174aa8` | `#a5c7ff` | Link hover. |
| `--wanderer-accent-contrast` | `#ffffff` | `#0a1630` | Text on the accent badge. |
| `--wanderer-accent-soft` | `#eaf1fd` | `#15223f` | Upcoming card background. |
| `--wanderer-accent-soft-text` | `#173f8f` | `#cfe0ff` | Upcoming card title link. |
| `--wanderer-accent-soft-border` | `#c3d6f6` | `#27417a` | Upcoming card border. |
| `--wanderer-link` | `var(--wanderer-accent)` | same | Accent used as text: link buttons, talk title hover, location talk links, milestone title, back button hover, tooltip icon. Override it when your accent is too light to read as text. |

### Selected state and controls

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-selected-bg` | `#18181b` | `#f4f4f5` | Pressed chip and view button background. |
| `--wanderer-selected-text` | `#ffffff` | `#09090b` | Pressed chip and view button text. |
| `--wanderer-selected-border` | `#18181b` | `#f4f4f5` | Pressed chip and view button border. |
| `--wanderer-control-bg` | `#ffffff` | `#141417` | Search input, chips, buttons, actions. |
| `--wanderer-control-text` | `#18181b` | `#f4f4f5` | Control text. |
| `--wanderer-control-border` | `#c9c9d1` | `#42424c` | Control border. |
| `--wanderer-control-hover-bg` | `#f1f1f4` | `#232329` | Control hover background, clear button hover, location button hover. |
| `--wanderer-control-height` | `2.75rem` | same | Minimum height of the search input, chips, view buttons, buttons, the globe back button and (on coarse pointers) action links. |

### Focus

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-focus-ring` | `#1f5ed6` | `#7fb0ff` | 2px `:focus-visible` outline on links, buttons, inputs and focusable elements; search input focus border. |
| `--wanderer-focus-ring-offset` | `var(--wanderer-bg)` | same | Reserved for consumers that draw an offset ring. |

### Overlays

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-overlay-bg` | `rgba(255, 255, 255, 0.9)` | `rgba(20, 20, 23, 0.9)` | Globe panel and back button background (with backdrop blur). |
| `--wanderer-overlay-border` | `#e4e4e7` | `#2a2a31` | Globe panel, tooltip, milestone and back button borders. |
| `--wanderer-backdrop` | `#ffffff` | `#09090b` | Background of the immersive globe. |
| `--wanderer-z-overlay` | `30` | same | `z-index` of the immersive globe. |

### Typography

| Token | Default | Affects |
|---|---|---|
| `--wanderer-font` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Body font. |
| `--wanderer-font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | Counts, dates in the card margin, meta rows, badges, hints. |
| `--wanderer-font-heading` | `var(--wanderer-font)` | View headings, group titles, talk titles, globe section titles. |
| `--wanderer-font-size` | `1rem` | Root font size. |
| `--wanderer-font-size-sm` | `0.875rem` | Controls, event line, description, region rows. |
| `--wanderer-font-size-xs` | `0.75rem` | Counts, meta rows, badges, actions, hints. |
| `--wanderer-line-height` | `1.5` | Root line height. |

### Spacing

| Token | Default |
|---|---|
| `--wanderer-space-1` | `0.25rem` |
| `--wanderer-space-2` | `0.5rem` |
| `--wanderer-space-3` | `0.75rem` |
| `--wanderer-space-4` | `1rem` |
| `--wanderer-space-5` | `1.5rem` |
| `--wanderer-space-6` | `2rem` |
| `--wanderer-space-7` | `3rem` |

Gaps, paddings and margins throughout use these steps.

### Radii

| Token | Default | Affects |
|---|---|---|
| `--wanderer-radius-sm` | `0.375rem` | Focus outline, error box, location buttons. |
| `--wanderer-radius-md` | `0.75rem` | Upcoming cards, tooltips, milestone cards. |
| `--wanderer-radius-lg` | `1rem` | Empty state, globe panel, globe stage. |
| `--wanderer-radius-full` | `999px` | Pills: search input, chips, buttons, badges, dots. |

### Shadows

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-shadow-sm` | `0 1px 2px rgba(9, 9, 11, 0.06)` | `0 1px 2px rgba(0, 0, 0, 0.4)` | Reserved for consumers. |
| `--wanderer-shadow-md` | `0 6px 18px rgba(9, 9, 11, 0.1)` | `0 6px 18px rgba(0, 0, 0, 0.5)` | Globe panel, back button. |
| `--wanderer-shadow-lg` | `0 18px 40px rgba(9, 9, 11, 0.16)` | `0 18px 40px rgba(0, 0, 0, 0.6)` | Tooltip, milestone card. |

### Motion

| Token | Default | Affects |
|---|---|---|
| `--wanderer-duration` | `160ms` | Control transitions. |
| `--wanderer-duration-slow` | `420ms` | Milestone callout entrance. |
| `--wanderer-easing` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | All transitions and keyframes. |

### Globe

| Token | Light | Dark | Affects |
|---|---|---|---|
| `--wanderer-globe-land` | `#2b2b33` | `#d6d6de` | Land color passed to the WebGL renderer. |
| `--wanderer-globe-marker` | `#1f5ed6` | `#7fb0ff` | Marker color in WebGL and the dots in the location list. |
| `--wanderer-globe-bg` | `#ffffff` | `#09090b` | Globe background color passed to the renderer. |
| `--wanderer-globe-glow` | `#ffffff` | `#17171b` | Glow color passed to the renderer. |
| `--wanderer-globe-connector` | `#1f5ed6` | `#7fb0ff` | Dashed connector lines from milestone dots to the callout (`.wanderer-globe__connectors`). |
| `--wanderer-globe-max-size` | `44rem` | same | Maximum width of the square globe stage. |
| `--wanderer-globe-reveal-duration` | `920ms` | same | Cross-fade from the intro sketch to the globe canvas. Override it on `.wanderer`, a theme selector or the `tokens` prop like any other token. |

The globe view reads `--wanderer-globe-land`, `--wanderer-globe-marker`, `--wanderer-globe-bg` and `--wanderer-globe-glow` from the computed style of its stage element and converts them to 0 to 1 RGB for WebGL. Any CSS color syntax the browser can resolve works. The values are read on mount and again when `theme` or the color scheme changes, so overrides from consumer CSS and the `tokens` prop reach the renderer. The renderer falls back to built-in values when a token is empty.

In the immersive presentation the layout is one grid row of `minmax(0, 1fr)`, so the panel scrolls internally and the stage centers in the visible area. The stage width is `min(100%, 76vh, var(--wanderer-globe-max-size))` at and above 1024 pixels and `min(100%, 44vh, var(--wanderer-globe-max-size))` below, where the panel moves under the stage and is capped at `38vh`.

## Class naming

Classes are prefixed `wanderer-` and follow a BEM-like scheme: block (`wanderer-talk`), element (`wanderer-talk__title`), modifier (`wanderer-badge--accent`). The main blocks:

| Block | Purpose |
|---|---|
| `wanderer`, `wanderer--error` | Root section; error variant in strict validation. |
| `wanderer-shell`, `--small`, `--large`, `--active` | Responsive shells. |
| `wanderer-toolbar`, `wanderer-search`, `wanderer-filters`, `wanderer-chip`, `wanderer-views`, `wanderer-views__button`, `wanderer-toolbar__count`, `wanderer-link-button` | Toolbar. |
| `wanderer-view`, `wanderer-view__heading` | View wrapper and heading. |
| `wanderer-list`, `wanderer-group`, `wanderer-group__header`, `__title`, `__dot`, `__count`, `__list`, `__list--cards`, `__item` | List and groups. |
| `wanderer-talk`, `__when`, `__body`, `__title`, `__title-link`, `__event`, `__meta`, `__meta-item`, `__meta-icon`, `__description`, `__actions` | Talk card. |
| `wanderer-action`, `wanderer-action__icon`, `wanderer-badge`, `--accent`, `--muted`, `wanderer-button` | Actions and badges. |
| `wanderer-empty`, `__icon`, `__title`, `__description`, `__action`, `wanderer-error` | Empty and error states. |
| `wanderer-globe`, `--inline`, `--immersive`, `__layout`, `__panel`, `__panel-scroll`, `__summary`, `__lists`, `__section`, `__section-title`, `__regions`, `__region`, `__locations`, `__location`, `__location-button`, `__location-panel`, `__location-talks`, `__stage-wrap`, `__stage`, `__loading`, `__hint`, `__overlay`, `__callout`, `__back` | Globe view. `__overlay` holds the `GlobeStageOverlay` slot over the stage. |
| `wanderer-globe__scene`, `__layer`, `__canvas`, `__intro`, `__connectors`, `__connector`, `__milestone-dot`, `__tooltip`, `__tooltip-header`, `__tooltip-icon`, `__tooltip-stats`, `__tooltip-label`, `__tooltip-value`, `__tooltip-footer` | Globe renderer layers: the cobe canvas, the intro sketch, connectors, milestone dots and the hover tooltip. |
| `wanderer-milestone`, `__media`, `__image`, `__body`, `__title`, `__description` | Milestone card. |
| `wanderer-visually-hidden`, `wanderer-visually-hidden--focusable` | Screen reader utilities. |

Class names are a public styling surface. Reuse `wanderer-chip`, `wanderer-button`, `wanderer-action` and `wanderer-talk` in custom renderers to inherit sizing and states.

## Overriding

Three levels, from broad to narrow:

1. **Consumer CSS on `.wanderer`.** Redefine tokens or style elements directly. Load your stylesheet after `styles.css`, or use a more specific selector.

   ```css
   .wanderer {
     --wanderer-accent: #ff6600;
     --wanderer-font-heading: "Inter", sans-serif;
     --wanderer-radius-full: 0.5rem;
   }
   .wanderer[data-wanderer-theme="dark"] {
     --wanderer-accent: #ff8433;
   }
   ```

2. **Per-instance `tokens` prop.** Inline custom properties on the root, highest precedence.

   ```tsx
   <Talks talks={talks} tokens={{ '--wanderer-accent': '#ff6600', '--wanderer-globe-max-size': '36rem' }} />
   ```

3. **`className` and `style`.** `className` is appended to the root for scoping (`.my-talks .wanderer-talk { ... }`). `style` merges after `tokens`.

## Precedence

Lowest to highest:

1. Defaults on `.wanderer`.
2. Theme palette: `data-wanderer-theme="dark"`, or `system` with the OS preference.
3. Host scheme hint: `[data-wanderer-scheme]` on an ancestor, for `system` only.
4. Consumer CSS (ordinary cascade rules apply).
5. Inline tokens from the `tokens` prop, then `style`.

The palette rules and the hint are plain class and attribute selectors with no `!important`, so a consumer selector of equal or higher specificity loaded later wins.

## Dark mode

- `theme="light"` or `"dark"` sets `data-wanderer-theme` and the palette follows it regardless of the OS.
- `theme="system"` (default) uses `prefers-color-scheme` in CSS. On the server and during hydration the component reports `colorScheme: 'light'` in its context; the CSS already paints dark when the OS prefers it, so there is no flash for pure system themes.
- **Hosts with their own toggle**: resolve the theme in the host and pass `theme="dark"` or `"light"`. If the host resolves the theme before hydration with an inline script, also set `data-wanderer-scheme="dark"` or `"light"` on `<html>` or any ancestor. Under `system`, the stylesheet uses that hint instead of the OS preference, so the first paint matches the host even before React runs. After hydration `useColorScheme` reads the nearest ancestor hint too and watches it with a `MutationObserver`, so under `system` the context's `colorScheme` and the globe's default WebGL colors follow the hint ahead of the OS preference. Passing an explicit `theme` once hydrated is still the simplest way to keep everything in sync.
- The root sets the `color-scheme` property (`light` or `dark`), so native controls such as the search field's cancel button and scrollbars match.
- Nothing is written to `localStorage` and no theme is persisted. The host owns persistence.

## RTL

`direction="rtl"` sets `dir="rtl"` on the root. The stylesheet uses logical properties (`inline-size`, `inset-inline-start`, `padding-inline`, `margin-inline-start`) so the toolbar, search icon, clear button, cards and globe panel mirror. The globe back arrow flips with `[dir="rtl"]`, the milestone callout uses an RTL slide-in, and the trackpad gesture direction inverts.

## Reduced motion and forced colors

- `prefers-reduced-motion: reduce` sets every animation and transition inside `.wanderer` to 0.01 ms and stops the loading pulse. In the globe, the intro sketch is hidden, the canvas shows at once and connector and dot transitions are removed. The view also passes `reducedMotion` to the renderer, which skips the intro, disables auto-rotation and snaps focus rotations.
- `forced-colors: active` (Windows High Contrast) keeps borders on chips, buttons, actions, the search input and the back button using `ButtonText` and `ButtonFace`, renders pressed states with `Highlight` and `HighlightText`, draws a 3px `Highlight` focus outline, and uses `CanvasText` for structural borders.

## Data attributes

On the root `<section class="wanderer">`:

| Attribute | Values | When |
|---|---|---|
| `data-wanderer-view` | a view id | After hydration, or always without `responsive`. Absent while both shells render. |
| `data-wanderer-view-small` | a view id | Only while both shells render: the small shell's view. |
| `data-wanderer-view-large` | a view id | Only while both shells render: the large shell's view. |
| `data-wanderer-breakpoint` | number | When `responsive` is set. |
| `data-wanderer-instance` | React `useId` value | Always. Scopes the custom breakpoint style. |
| `data-wanderer-theme` | `light`, `dark`, `system` | Always. |
| `data-wanderer-density` | `comfortable`, `compact` | Always (not on the strict validation error root). |
| `dir` | `ltr`, `rtl` | Always. |

Inside the component:

| Attribute | On | Values |
|---|---|---|
| `data-wanderer-shell` | `.wanderer-shell` | `small`, `large`, `active` |
| `data-wanderer-view-id` | `.wanderer-view` | view id |
| `data-wanderer-group` | `.wanderer-group` | `upcoming`, `year-YYYY`, `undated` |
| `data-wanderer-upcoming` | `.wanderer-talk` | `true` or absent |
| `data-wanderer-format` | `.wanderer-talk` | `in-person`, `online`, `hybrid` |
| `data-wanderer-link` | anchors | link kind |
| `data-wanderer-globe-status` | `.wanderer-globe` | `idle`, `loading`, `ready`, `error` |
| `data-wanderer-callout` | `.wanderer-globe__stage` | `beside` when the measured free inline-end space fits the milestone callout next to the stage (connector lines are drawn), `overlay` when it must sit over the stage. |
| `data-wanderer-globe-error` | `.wanderer-globe` | `module`, `webgl`, `runtime` or absent |
| `data-wanderer-paused` | `.wanderer-globe__stage`, `.wanderer-globe__canvas` | `true` when the page is hidden or the stage is offscreen |
| `data-wanderer-intro` | `.wanderer-globe__scene` | `particles`, `reveal`, `fade`, `done`: the intro cross-fade phase |
| `data-wanderer-active` | `.wanderer-globe__connector`, `.wanderer-globe__milestone-dot` | `true` for the active milestone |
| `data-wanderer-milestone` | `.wanderer-globe__milestone-dot` | milestone id |
| `data-wanderer-tooltip-position` | `.wanderer-globe__tooltip` | `above` when flipped above the marker |
| `data-wanderer-expanded` | `.wanderer-globe__location` | `true` when its panel is open |
| `data-wanderer-milestone` | `.wanderer-globe__callout` | active milestone id |

## Recipe: host scroll locking for the immersive globe

`globeView({ presentation: 'immersive' })` fixes the globe to the viewport. Lock page scrolling from the host with `:has()`, and cover the pre-hydration state where only the per-shell attributes exist:

```css
/* After hydration */
body:has(.wanderer[data-wanderer-view="globe"]) {
  overflow: hidden;
}

/* Before hydration, both shells exist; match the breakpoint the component uses */
@media (min-width: 1024px) {
  body:has(.wanderer[data-wanderer-view-large="globe"]) {
    overflow: hidden;
  }
}
@media (max-width: 1023.98px) {
  body:has(.wanderer[data-wanderer-view-small="globe"]) {
    overflow: hidden;
  }
}
```

Use the same breakpoint as `responsive.breakpoint`. Hosts can hide their own chrome with the same selectors.
