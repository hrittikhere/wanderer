# Changelog

## Unreleased

- Constrain cobe to the compatible 0.6.5 API and align Node engines, portable test discovery and CI.
- Set the missing cobe base-brightness uniform explicitly, fixing a black globe caused by a NaN shader value.
- Put fullscreen navigation inside a native dialog with an explicit exit, focus containment and background scroll locking.
- Keep compact milestone cards beside or below the globe, with full-photo links, manual selection, pause/resume and dismiss controls. Respect reduced motion for automatic callouts.
- Contain preload failures and cancel pending controlled-view focus when the visitor moves elsewhere.
- Reject unsafe links from plugin actions and direct `TalkLinkAnchor` usage before reaching routers.
- Add runnable Vite and Next.js examples, packed-consumer production builds, bundle budgets, browser regression tests and axe checks in CI.
- Correct installation, fallback, SSR and integration documentation to match the tested behavior.
- Fix the CommonJS build's globe: the renderer unwraps `cobe`'s default export, which the CommonJS interop bound to the module namespace. `npm test` now mounts the globe from both built copies.
- Share one React context between the ESM and CommonJS copies, so `useTalks` works across the dual-package boundary.
- Ship per-condition declarations (`dist/cjs/*.d.ts` for `require`), `typesVersions` for `node10` resolution, the `src` files the source maps reference, and `publishConfig.access: public`. The package-smoke check compiles a TypeScript 5.0 consumer under every resolution mode.
- `engines` now states the runtime floor (Node 20 or later) instead of the test toolchain's range, which moved to `devEngines`.
- The globe renderer keeps one WebGL globe per mount and updates its markers in place, removes cobe's window resize listener and releases its WebGL context on unmount, so searching and switching views no longer leak contexts.
- The globe intro advances on rendered frames, so a globe mounted hidden or offscreen plays it later and lands on the busiest location; the sketch now honors `--wanderer-globe-reveal-duration`.
- Idle rotation is time-based (the same speed at any refresh rate), the drawing buffer follows `devicePixelRatio` changes, and a second pointer no longer resets or ends a drag.
- At most 64 markers are drawn (the busiest), matching cobe's limit; hover only finds drawn markers.
- The hover tooltip can be dismissed with Escape, stays dismissed until the pointer leaves the marker, can be hovered, and is positioned by its rendered width.
- Milestone callouts close as soon as their dot turns behind the globe; repeated milestone ids keep the first milestone.
- `parseCssColor` rejects malformed channels instead of returning NaN and runs in linear time.
- Globe markers are merged once from all talks and narrowed for search and filters, so a location keeps its id, label and open panel while its host talk is filtered out, and the globe is not rebuilt. A host without a location takes the first label among its merged talks; `mergeDistanceKm: 0` merges both encodings of an antimeridian or pole point.
- `deriveGeography` buckets hosts in a spatial grid: time grows with the number of talks, not talks times locations.
- Search and filter changes filter the list in a deferred render, so typing stays responsive with long lists. Refilling an emptied globe remounts the loaded renderer without a loading pass.
- Stylesheet: the search field border reaches 3:1 contrast (new `--wanderer-input-border` token); text fields stay at 16px on touch devices so iOS does not zoom; the full-photo link meets the 44px touch target; the nearest `data-wanderer-scheme` hint wins when hints are nested; milestone dots stay on their markers in RTL; long location and region names wrap; the beside callout no longer covers the globe controls; the Dismiss focus ring is not clipped; the RTL callout entrance follows the component's direction; every transition follows `--wanderer-easing`.
- The globe stage and its controls precede the location panel in the DOM, so focus order matches the layout at every width (wide layouts place the panel in the first column with CSS grid).
- Fullscreen follows the browser: when the browser closes the dialog itself (repeated Escape with `escapeToList={false}` or an `isModalOpen` veto, the Android back gesture), the component returns to the inline view instead of hiding everything; a controlled parent that declines gets the dialog back.
- Fullscreen opens only for a view the visitor or the consumer chose, and only after hydration: an immersive view that is the `responsive` default, on load or after a breakpoint crossing, shows inline (and is visible in the server HTML); choosing it opens fullscreen. `TalkViewProps.presentation` and the `wanderer-globe--inline`/`--immersive` modifier report the presentation in effect.
- Escape is held back only by text fields that have text, and clears only the component's own search field (including a text-type `SearchInput` slot); checkboxes and ranges no longer swallow it, and a plugin's own search field no longer clears the component's search.
- Choosing the view that is already shown no longer leaves a focus request that a later controlled change would act on.
- The fullscreen scroll lock also covers hosts that scroll `body`, and the shell stacks at `--wanderer-z-overlay` where `showModal()` is unavailable.

All notable changes to `@wanderer/talks` are recorded here. The format follows Keep a Changelog, and the project follows Semantic Versioning.

## 0.1.0

Initial release.

### Added

- `Talks` root component with per-instance plugin registry, controlled or uncontrolled view, search and filters, responsive view selection that renders both shells on the server, Escape-to-list, opt-in trackpad gestures, focus management on view switches and a polite debounced result announcement.
- Portable `Talk` schema with typed links (`event`, `recording`, `slides`, `detail`, `general`), `format`, string or object `location`, `coordinates` and `tags`.
- `validateTalks` with `strict` and `lenient` modes, structured errors and warnings, and a safe projection that never mutates the source.
- Pure helpers: `filterTalks`, `groupTalks`, `sortTalks`, `parseCalendarDate`, `formatCalendarDate`, `isUpcoming`, `classifyTalkDate`, `talkYear`, `normalizeSearch`, `safeUrl`, `getTalkLinks`, `getPrimaryLink`, `locationLabel`, `locationParts`, `validCoordinates`, `resolveTalkCoordinates`, `geographicDistanceKm`, `deriveGeography`, `compareIds`, `registerPlugins`, `collectContributions`. `definePlugin` (constrained to `TalksPlugin`) is exported from the root and from `./helpers`.
- List pieces `ListView`, `TalkCard`, `Toolbar`, `Heading`, `TalkGroupSection`, `EmptyState`, `TalkLinkAnchor` and `resolveLinkPolicy` from the root and `./list` entries.
- List view with Upcoming, year and Undated groups, empty and no-match states, talk cards with primary link, actions, badges and density modes.
- Globe view (`@wanderer/talks/globe`): lazy-loaded `cobe` renderer with drag rotation, auto-rotation, hover tooltips, a particle intro that cross-fades into the globe, milestone dots with connectors and a replaceable callout card, WebGL detection, module, WebGL and runtime fallbacks, a no-mapped-talks state that skips the WebGL check and the renderer import when there are zero markers, CommonJS interop for the lazy renderer import, pause when hidden or offscreen, keyboard-accessible region and location lists that rotate the globe to the expanded location, inline and immersive presentations, `preloadGlobeView`.
- Plugin contract: views, filters, actions (link or button), renderers and slots (`SearchInput`, `GlobeOverlayCard`, `GlobeAside`, `GlobeStageOverlay`) with deterministic ordering, reserved ids and loud duplicate detection. `definePlugin` and `useTalks`. `TalksContext.breakpoint` exposes the responsive breakpoint.
- Navigation options: `LinkComponent` for chosen kinds, `onNavigate` for unmodified primary clicks, per-kind target and rel policies with `noopener` enforcement, configurable primary link precedence.
- Stylesheet with `--wanderer-*` tokens (including `--wanderer-link` for accent used as text and `--wanderer-globe-reveal-duration`), light, dark and system palettes, `data-wanderer-scheme` host hint, logical properties for RTL, reduced motion and forced colors support, and root data attributes for host integration.
- Copy table covering every string and accessible label, `createDefaultCopy` and `mergeCopy`, locale and date format options.
- Hooks: `useMediaQuery`, `useColorScheme` (honors an ancestor `data-wanderer-scheme` hint under `theme="system"`), `usePrefersReducedMotion`, `useIsClient`, `useControllable`.
- ESM and CommonJS builds with preserved `"use client"` directives, TypeScript declarations, four entry points (`.`, `./helpers`, `./list`, `./globe`) and `./styles.css`.
- Documentation: README plus configuration, plugins, styling, SSR, links and migration guides.
