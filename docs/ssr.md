# Server rendering and hydration

The component renders complete HTML on the server and hydrates without warnings. This page explains the model and what to do at React Server Component boundaries.

## Hydration model

- **Responsive shells.** With the `responsive` prop, the server does not know the viewport width. The HTML contains two shells, `.wanderer-shell--small` and `.wanderer-shell--large`, each with its own toolbar and view body. The stylesheet hides one per breakpoint (an inline instance-scoped `<style>` is added for a custom breakpoint). The first client render produces exactly the same tree, so hydration matches.
- **Media query via `useSyncExternalStore`.** `useMediaQuery` returns `undefined` for the server snapshot and during hydration, then the live match. When the value resolves, the component drops the inactive shell and renders one `.wanderer-shell--active`. The same hook powers `useColorScheme` and `usePrefersReducedMotion`; both report their defaults (`light`, `false`) until hydration completes.
- **No `suppressHydrationWarning`.** Nothing in the library reads `window`, `Date`, `Math.random` or `matchMedia` during render. Client-only state is introduced after hydration through effects or `useSyncExternalStore`.
- **Ids.** All ids derive from React's `useId`, so server and client agree. The `data-wanderer-instance` attribute carries that id.
- **Views receive `active={false}`** while both shells render. The globe uses this to defer loading until the viewport is measured.
- **Strict validation errors** render as a static `<section role="alert">` on the server too.

Without `responsive`, one shell renders from the first pass and the only post-hydration change is the color scheme under `theme="system"`, which the CSS already handles.

## RSC boundaries

Which modules carry `"use client"`:

| Entry | Client modules | Pure modules |
|---|---|---|
| `@wanderer/talks` | `Talks`, `ListView`, `TalkCard`, `Toolbar`, `TalkLinkAnchor`, `resolveLinkPolicy`, `ErrorBoundary`, `useTalks`, every hook | helpers, `Heading`, `createDefaultCopy`, `mergeCopy`, `definePlugin`, `registerPlugins`, `collectContributions` |
| `@wanderer/talks/list` | `ListView`, `TalkCard`, `Toolbar`, `TalkGroupSection`, `EmptyState`, `TalkLinkAnchor`, `resolveLinkPolicy` | `Heading` |
| `@wanderer/talks/globe` | everything | type exports only |
| `@wanderer/talks/helpers` | none | everything |

`resolveLinkPolicy` is a plain function, but it lives in the same module as `TalkLinkAnchor`, which carries `"use client"`, so importing it into a Server Component makes it a client reference. Resolve policies in a client module.

The build transpiles file by file, so each module's directive survives and bundlers that understand `"use client"` treat `Talks` as a client reference automatically. A Server Component may import and render `<Talks>` directly as long as every prop is serializable: `talks`, `referenceDate`, `copy` without function keys, `locale`, `dateFormat`, `direction`, `theme`, `tokens`, `density`, `headingLevel`, `viewHeadings`, `defaultView`, `enabledViews`, `responsive`, `defaultSearch`, `defaultFilters`, `builtinFilters`, `grouping`.

Everything else holds functions or components and cannot cross the boundary: `plugins`, `views`, `slots`, `navigation`, `ImageComponent`, `geography`, `milestones` with images is fine but `geography.resolveCoordinates` is not, `onViewChange`, `onSearchChange`, `onFiltersChange`, `onValidation`, `isModalOpen`, and function-valued `copy` keys. Put these in a client adapter:

```tsx
// talks-client.tsx
'use client';
import { Talks, type Talk } from '@wanderer/talks';
import { globeView } from '@wanderer/talks/globe';

const views = [globeView()];

export function TalksClient(props: { talks: Talk[]; referenceDate: string }) {
  return <Talks {...props} views={views} responsive={{ small: 'list', large: 'globe' }} />;
}
```

The Server Component imports `validateTalks` and the other helpers from `@wanderer/talks/helpers`, which has no client modules, and passes plain data to the adapter. The README shows the full Next.js example with `next/link`, `next/image` and a theme bridge.

## Reference date snapshot

The library never calls `Date.now()`. Supply `referenceDate` as `YYYY-MM-DD`:

- Client-only apps: compute it once at startup.
- Next.js with Cache Components: compute it inside a `'use cache'` function with `cacheLife('hours')` and pass the string down. The value is pinned when the cache entry fills and refreshes on revalidation, so upcoming and past are consistent between the HTML and the client without hydration mismatches.
- Static exports: the build-time value is used until the next build. If that is too stale, keep `referenceDate` out of the server render and set it in an effect on the client; talks then render as past first and reflow to upcoming after mount.

## Lazy globe loading

`globeView(options)` returns a `ViewContribution` with id `globe`. Pass it through `views`; importing the globe entry registers nothing by itself.

Loading sequence inside `GlobeView`:

1. On the server and during hydration the view renders its panel (region and location lists, summary) and a loading disc with `copy.loadingGlobe` in a polite live region. `data-wanderer-globe-status="idle"`.
2. After hydration, with zero markers (no mapped talks, or a filter that leaves none), the stage shows `copy.noMappedTalks` and `copy.noMappedDescription` with the list button at once. Status stays `idle`, no WebGL check runs and the renderer is never imported. The rest of the sequence applies only once at least one marker exists.
3. When the view is `active` and has markers, status becomes `loading`. A WebGL check creates a canvas and asks for `webgl2`, `webgl`, then `experimental-webgl`.
4. **WebGL unavailable**: status `error`, `data-wanderer-globe-error="webgl"`. The stage shows `copy.globeUnavailable` and `copy.globeUnavailableDescription` with a button (`copy.useList`) that switches to the list view when one is registered.
5. Otherwise the renderer module is imported dynamically. That module is the only file that imports `cobe`.
6. **Module missing or failing** (for example `cobe` is not installed, or the chunk fails to download): status `error`, `data-wanderer-globe-error="module"`, same fallback. The import promise is cleared so a later mount retries.
7. **Module loaded**: status `ready`. The renderer mounts inside an error boundary.
8. **Renderer throws at runtime**: the boundary shows the unavailable fallback and sets `data-wanderer-globe-error="runtime"`.

If the markers drop to zero later (for example a filter removes every mapped talk), the stage switches to the no-mapped-talks state while the status attribute keeps its last value.

`preloadGlobeView()` starts the import early and resolves when it finishes. It is a no-op on the server. The view toggle calls it on pointer enter and focus through the contribution's `preload`. Call it yourself after the page is idle to warm the chunk:

```ts
import { preloadGlobeView } from '@wanderer/talks/globe';

useEffect(() => {
  const id = window.requestIdleCallback?.(() => { void preloadGlobeView(); });
  return () => { if (id !== undefined) window.cancelIdleCallback?.(id); };
}, []);
```

### Pausing

The view computes `paused` from `document.visibilityState` and an `IntersectionObserver` on the stage. The renderer receives `paused` through `GlobeRendererProps`, and the stage and canvas carry `data-wanderer-paused="true"`. The bundled renderer stops the `cobe` render loop and its own frame loops while paused and resumes when the flag clears.

### Colors and motion

The view reads the `--wanderer-globe-*` tokens from the stage's computed style and passes 0 to 1 RGB values to the renderer, so CSS overrides and the `tokens` prop apply to WebGL. `prefers-reduced-motion` is passed as `reducedMotion`; connector lines are enabled only at and above `context.breakpoint` (`responsive.breakpoint`, or `DEFAULT_BREAKPOINT`, 1024 pixels).

### Renderer contract

`GlobeRendererProps` from `@wanderer/talks/globe` documents everything the view passes: `markers`, `milestones` (with resolved coordinates), `colors`, `colorScheme`, `reducedMotion`, `paused`, `intro`, `autoRotate`, `showConnectors`, `calloutAnchor`, `copy`, `locale`, `direction`, `formatDate`, `activeMilestoneId`, `onActiveMilestoneChange`, `focusMarkerId` (the location expanded in the accessible list) and optional `renderMarkerTooltip`. The bundled renderer lives in `globe/renderer` and is the only module that imports `cobe`. It layers the cobe canvas, a 2D particle intro that cross-fades into the globe (decided once per mount; skipped under reduced motion, when `intro` is false, or with no markers), dashed SVG connectors and dots for milestones, and a hover tooltip. Everything that touches the DOM or the clock runs in effects and frame callbacks, so the module evaluates in plain Node.

## Bundle notes

- The root entry does not import the globe. Consumers that never import `@wanderer/talks/globe` ship no renderer and no `cobe`.
- The globe entry itself is small; the renderer and `cobe` are in a separate chunk created by the dynamic import. Bundlers that support code splitting (Vite, Next.js, webpack, esbuild with splitting) load it on demand.
- `sideEffects` in `package.json` lists only CSS, so unused exports tree-shake.
- Both `dist/esm` and `dist/cjs` are provided. The CommonJS build keeps the dynamic `import()` expression, so the renderer and `cobe` stay out of the initial evaluation path there as well. The loader unwraps both module shapes (`module.default` as the component, or a CommonJS exports object nested under `default`), so the lazy import works in plain Node CommonJS too.
- Sizes measured by `scripts/verify-dist.mjs` (sum of each entry's own ESM modules, raw and gzip -9, `react` and `cobe` excluded): helpers 14.9 kB raw / 4.8 kB gzip, root 58.3 / 18.2, list 31.2 / 9.9, globe 41.3 / 12.5, lazy renderer chunk 34.9 / 10.3, stylesheet 35.8 / 6.5.
