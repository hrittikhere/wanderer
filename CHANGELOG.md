# Changelog

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
