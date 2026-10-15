# Server rendering and hydration

The component renders complete HTML on the server and hydrates without warnings. This page explains the model and what to do at React Server Component boundaries.

## Hydration model

- **Responsive shells.** With the `responsive` prop, the server does not know the viewport width. The HTML contains two shells, `.wanderer-shell--small` and `.wanderer-shell--large`, each with its own toolbar and view body (one `.wanderer-shell--active` when both breakpoints resolve to the same view). The stylesheet hides one per breakpoint (an inline instance-scoped `<style>` is added for a custom breakpoint), so the right shell shows before any script runs. The first client render produces exactly the same tree, so hydration matches.
- **Media query via `useSyncExternalStore`.** `useMediaQuery` returns `undefined` for the server snapshot and during hydration, then the live match. When the value resolves, the component drops the inactive shell and renders one `.wanderer-shell--active`. The same hook powers `useColorScheme` and `usePrefersReducedMotion`; both report their defaults (`light`, `false`) until hydration completes.
- **`suppressHydrationWarning` only on card dates.** Nothing in the library reads `window`, `Date`, `Math.random` or `matchMedia` during render. Client-only state is introduced after hydration through effects or `useSyncExternalStore`. Dates are formatted during render with `Intl.DateTimeFormat`, whose output depends on the runtime's ICU data, so a server and a browser on different ICU versions can disagree for some locales (current data abbreviates September as `Sept` in `en-GB`, older data as `Sep`). The card's `<time>` element and its margin month carry `suppressHydrationWarning`, so such a difference keeps the server's text instead of making React discard and re-render the tree.
- **Ids.** All ids derive from React's `useId`, so server and client agree. The `data-wanderer-instance` attribute carries that id.
- **Views receive `active={false}`** while both shells render. The globe uses this to defer loading until the viewport is measured.
- **Server-side throws are contained.** Each view body and each custom renderer sits in a `<Suspense>` boundary, so one that throws during server rendering is left out of the HTML and rendered on the client instead of failing the page. React 18 can hydrate such a boundary ahead of an update only when the update is not urgent, and the render that follows hydration is urgent (the viewport and color scheme resolve through `useSyncExternalStore`). So views and the context provider keep the props they hydrated with until a deferred render right after it, and React 18 and 19 both keep the server HTML.
- **Strict validation errors** render as a static `<section role="alert">` on the server too.

Without `responsive`, one shell renders from the first pass and the only post-hydration change is the color scheme under `theme="system"`, which the CSS already handles.

## RSC boundaries

Which modules carry `"use client"`:

| Entry | Client modules | Pure modules |
|---|---|---|
| `@wanderer/talks` | `Talks`, `ListView`, `TalkCard`, `Toolbar`, `TalkLinkAnchor`, `resolveLinkPolicy`, `ErrorBoundary`, `useTalks`, every hook | helpers (including `DEFAULT_BREAKPOINT`), `Heading`, `createDefaultCopy`, `mergeCopy`, `definePlugin`, `registerPlugins`, `collectContributions` |
| `@wanderer/talks/list` | `ListView`, `TalkCard`, `Toolbar`, `TalkGroupSection`, `EmptyState`, `TalkLinkAnchor`, `resolveLinkPolicy` | `Heading` |
| `@wanderer/talks/globe` | everything | type exports only |
| `@wanderer/talks/helpers` | none | everything |

`resolveLinkPolicy` is a plain function, but it lives in the same module as `TalkLinkAnchor`, which carries `"use client"`, so importing it into a Server Component makes it a client reference. Resolve policies in a client module. `DEFAULT_BREAKPOINT` lives in the helpers module, so a Server Component can import it from either entry and compute with it.

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
6. **Module missing or failing** (for example a chunk fails to download): status `error`, `data-wanderer-globe-error="module"`, same fallback. The import promise is cleared so a later mount retries.
7. **Module loaded**: status `ready`. The renderer mounts inside an error boundary.
8. **Renderer throws at runtime**: the boundary shows the unavailable fallback and sets `data-wanderer-globe-error="runtime"`.

If the markers drop to zero later (for example a filter removes every mapped talk), the stage switches to the no-mapped-talks state while the status attribute keeps its last value.

`preloadGlobeView()` starts the import early and resolves when it finishes. It is a no-op on the server. The view toggle calls it on pointer enter and focus through the contribution's `preload`. Call it yourself after the page is idle to warm the chunk:

```ts
import { preloadGlobeView } from '@wanderer/talks/globe';

useEffect(() => {
  const id = window.requestIdleCallback?.(() => { void preloadGlobeView().catch(() => {}); });
  return () => { if (id !== undefined) window.cancelIdleCallback?.(id); };
}, []);
```

### Pausing

The view computes `paused` from `document.visibilityState` and an `IntersectionObserver` on the stage. The renderer receives `paused` through `GlobeRendererProps`, and the stage and canvas carry `data-wanderer-paused="true"`. The bundled renderer stops the `cobe` render loop and its own frame loops while paused and resumes when the flag clears.

### Colors and motion

The view reads the `--wanderer-globe-*` tokens from the stage's computed style and passes 0 to 1 RGB values to the renderer, so CSS overrides and the `tokens` prop apply to WebGL. `prefers-reduced-motion` is passed as `reducedMotion`; connector lines are enabled only at and above `context.breakpoint` (`responsive.breakpoint`, or `DEFAULT_BREAKPOINT`, 1024 pixels).

### Renderer contract

`GlobeRendererProps` from `@wanderer/talks/globe` documents everything the view passes: `markers`, `milestones` (with resolved coordinates), `colors`, `colorScheme`, `reducedMotion`, `paused`, `intro`, `autoRotate`, `autoMilestones`, `showConnectors`, `calloutAnchor`, `copy`, `locale`, `direction`, `formatDate`, `activeMilestoneId`, `onActiveMilestoneChange`, `focusMarkerId` (the location expanded in the accessible list), optional `renderMarkerTooltip`, and optional `onContextLost` / `onContextRestored` (the renderer pauses on a lost WebGL context and rebuilds the globe when the browser restores it; the view falls back to the runtime error state if nothing comes back within 2 seconds of the globe being visible; the grace period does not run while the page is hidden or the stage is offscreen, and a renderer replaced in the meantime takes its pending loss with it). The bundled renderer lives in `globe/renderer` and is the only module that imports `cobe`. It layers the cobe canvas, a 2D particle intro that cross-fades into the globe (decided once per mount; skipped under reduced motion, when `intro` is false, or with no markers), dashed SVG connectors and dots for milestones, and a hover tooltip. Everything that touches the DOM or the clock runs in effects and frame callbacks, so the module evaluates in plain Node.

The renderer creates one WebGL globe per mount and hands a changed marker set (search, filters) to it on the next frame instead of compiling a new one. Unmounting removes every listener it added and releases its WebGL context at once, since browsers cap live contexts per page. cobe draws at most 64 markers: past that, the 64 busiest locations are drawn and hovered, while the accessible location list still lists every location. The intro and idle rotation advance with rendered frames and elapsed time, so a globe mounted in a hidden tab or below the fold plays its intro once it is visible, and the rotation speed does not depend on the display refresh rate. The drawing buffer follows `devicePixelRatio` changes (browser zoom, moving to another display). Only the pointer that starts a drag rotates the globe. The hover tooltip follows WCAG 1.4.13: Escape dismisses it (without also switching views), it stays dismissed until the pointer leaves that marker, and moving the pointer onto it keeps it open.

Importing the globe entry requires `cobe@^0.6.5` at build time. A missing peer is normally a bundler error before the runtime fallback can render.

## Bundle notes

- The root entry does not import the globe. Consumers that never import `@wanderer/talks/globe` ship no renderer and no `cobe`.
- The globe entry itself is small; the renderer and `cobe` are in a separate chunk created by the dynamic import. Bundlers that support code splitting (Vite, Next.js, webpack, esbuild with splitting) load it on demand.
- `sideEffects` in `package.json` lists only CSS, so unused exports tree-shake.
- Both `dist/esm` and `dist/cjs` are provided. The CommonJS build keeps the dynamic `import()` expression, so the renderer and `cobe` stay out of the initial evaluation path there as well. The loader unwraps both module shapes (`module.default` as the component, or a CommonJS exports object nested under `default`), and the renderer unwraps `cobe`'s default export the same way, so the CommonJS build draws the globe wherever WebGL exists (for example a bundle built from CommonJS source). `npm test` mounts the globe from both built copies under a fake WebGL context.
- `import` resolves `dist/esm` and `require` resolves `dist/cjs`. Both copies share one React context per React instance, so `useTalks` in a plugin package compiled to CommonJS sees a `<Talks>` rendered from the ESM copy. Loading one module system per bundle still avoids shipping both copies: publish plugin packages as ESM with `@wanderer/talks` as a peer dependency.
- `npm run verify:dist` reports current raw and gzip module graph sizes. `npm run test:package` builds isolated tarball consumers and enforces minified gzip budgets, including cobe for the globe bundle.
