# @wanderer/talks

Plugin-based React components and pure helpers for publishing a speaking history. It ships a list view with search, filters and upcoming grouping, an optional 3D globe, a typed link model, and a plugin contract for custom views, filters, actions, renderers and slots. It is framework-agnostic React: no Next.js, no router, no speaker data, no branding.

## Features

- Portable `Talk` schema with a validator (`strict` or `lenient`) that never mutates your data.
- List view grouped into Upcoming, years and Undated, with search, filter chips, result count and reset.
- Optional globe view: lazy-loaded WebGL renderer built on `cobe` with a particle intro, hover tooltips and milestone callouts, keyboard-accessible region and location lists, and fallbacks when WebGL or the module is unavailable.
- Typed links (`event`, `recording`, `slides`, `detail`, `general`) with unsafe-scheme rejection, per-kind target and rel policies, a primary link, and derived actions.
- Plugins: views, filters, actions, renderers and slots, registered per instance with deterministic ordering and no global state.
- Responsive view selection that renders on the server without hydration warnings.
- Controlled or uncontrolled view, search and filters.
- Theming through `--wanderer-*` custom properties: light, dark and system palettes, RTL, reduced motion and forced colors.
- Every visible string and accessible label is replaceable through `copy`; dates, including year headings, follow `locale`.
- Upcoming grouping uses the `referenceDate` you supply, never the current date. The globe uses an animation clock only.

## Installation

The package is not published to npm yet. Try the [runnable examples](https://github.com/hrittikhere/wanderer/blob/main/examples/README.md), or install a packed checkout:

```sh
git clone https://github.com/hrittikhere/wanderer.git
cd wanderer
npm ci
npm pack
# From your application directory, use the path to the generated tarball:
npm i /path/to/wanderer/wanderer-talks-0.1.0.tgz react react-dom
# Required when you import @wanderer/talks/globe:
npm i cobe@^0.6.5
```

The renderer uses the cobe 0.6 API. cobe 2 is not compatible. The peer is optional for list-only consumers, but a bundler still needs it installed when you import the globe entry; runtime fallback cannot repair a missing build dependency.

### Peer dependencies

| Package | Range | Required |
|---|---|---|
| `react` | `^18.2.0 \|\| ^19.0.0` | yes |
| `react-dom` | `^18.2.0 \|\| ^19.0.0` | yes |
| `cobe` | `^0.6.5` | yes when importing the globe; otherwise no |

The published code runs on Node 20 or later (server rendering, build tools and data scripts); CI server-renders the built package on the first release of Node 20, 22 and 24. Developing the package needs Node 22.22.2+, 24.15.0+ or 26+ for the test toolchain (`devEngines` in `package.json`); `.nvmrc` selects Node 24. The package ships ESM and CommonJS builds, TypeScript declarations for each (TypeScript 5.0 or later; `moduleResolution` `bundler`, `node16`, `nodenext` and `node10` all resolve every entry) and one plain CSS file.

## Minimal setup

```tsx
import '@wanderer/talks/styles.css';
import { Talks } from '@wanderer/talks';

const talks = [
  {
    id: 'kubecon-eu-2025-tenant-isolation',
    title: 'Tenant isolation without the hypervisor',
    event: 'KubeCon + CloudNativeCon Europe 2025',
    date: '2025-04-02',
    description: 'How user namespaces and seccomp keep workloads apart.',
    location: { city: 'London', country: 'United Kingdom' },
    coordinates: [51.5072, -0.1276],
    format: 'in-person',
    eventUrl: 'https://example.com/schedule/tenant-isolation',
    recordingUrl: 'https://www.youtube.com/watch?v=example',
  },
];

export function Page() {
  return <Talks talks={talks} referenceDate="2026-10-13" />;
}
```

`referenceDate` is an ISO calendar date (`YYYY-MM-DD`). Talks on or after it count as upcoming. Without it nothing is upcoming.

## Entry points

| Entry | Exports |
|---|---|
| `@wanderer/talks` | `Talks`, `DEFAULT_BREAKPOINT`, `useTalks`, `createDefaultCopy`, `mergeCopy`, `definePlugin`, the list pieces (`ListView`, `listView`, `TalkGroupSection`, `EmptyState`, `TalkCard`, `Toolbar`, `Heading`, `TalkLinkAnchor`, `resolveLinkPolicy`, `ErrorBoundary`), the hooks (`useMediaQuery`, `useColorScheme`, `usePrefersReducedMotion`, `useIsClient`, `useControllable`), everything from `./helpers`, and every component type. |
| `@wanderer/talks/helpers` | Pure functions, no `"use client"`: `validateTalks`, `filterTalks`, `groupTalks`, `sortTalks`, `parseCalendarDate`, `formatCalendarDate`, `isUpcoming`, `classifyTalkDate`, `talkYear`, `normalizeSearch`, `safeUrl`, `getTalkLinks`, `getPrimaryLink`, `DEFAULT_PRIMARY_LINK_PRECEDENCE`, `locationLabel`, `locationParts`, `validCoordinates`, `resolveTalkCoordinates`, `geographicDistanceKm`, `deriveGeography`, `compareIds`, `definePlugin`, `registerPlugins`, `collectContributions`, plus the schema types (`Talk`, `TalkLink`, `LinkKind`, `ValidationResult`, `Geography`, and so on). |
| `@wanderer/talks/list` | `ListView`, `listView`, `TalkCard`, `Toolbar`, `TalkGroupSection`, `EmptyState`, `TalkLinkAnchor`, `resolveLinkPolicy`, `Heading`, and the types `TalkViewProps`, `TalkRendererProps`, `ViewContribution`, `TalksContext`. |
| `@wanderer/talks/globe` | `GlobeView`, `globeView(options)`, `preloadGlobeView`, `GlobeRegionList`, and the types `GlobeViewOptions`, `GlobeColors`, `GlobeRendererProps`, `PositionedMilestone`, `Rgb`. |
| `@wanderer/talks/styles.css` | The stylesheet. Component styles are scoped to `.wanderer`; one `html:has()` rule locks scrolling while a Wanderer fullscreen dialog is open. |

`definePlugin` is exported from the root entry and from `./helpers`. It is an identity function typed `<T extends TalksPlugin>(plugin: T) => T`, so an unannotated literal gets contextual types for its callbacks.

### Which entry do I import?

| Where | Import |
|---|---|
| Server Components, Node scripts, build steps, tests of data | `@wanderer/talks/helpers` |
| A client component that renders the component | `@wanderer/talks` |
| Custom composition of the list pieces (your own view or renderer) | `@wanderer/talks/list` |
| The globe view | `@wanderer/talks/globe` |

List-only consumers never import `@wanderer/talks/globe`, so `cobe` and the WebGL renderer stay out of their bundle.

## Quick examples

### Vite (client only)

```tsx
// src/main.tsx
import '@wanderer/talks/styles.css';
import { createRoot } from 'react-dom/client';
import { Talks } from '@wanderer/talks';
import { globeView } from '@wanderer/talks/globe';
import { talks } from './talks';

// Client-only apps may read the clock once at startup.
const referenceDate = new Date().toISOString().slice(0, 10);
const views = [globeView()];

createRoot(document.getElementById('root')!).render(
  <Talks
    talks={talks}
    referenceDate={referenceDate}
    views={views}
    responsive={{ small: 'list', large: 'globe' }}
  />,
);
```

### Next.js App Router

The root component carries `"use client"`. Component-valued props (`LinkComponent`, `ImageComponent`, `plugins`, `views`, `slots`) are not serializable, so a Server Component cannot pass them. Compute the serializable inputs on the server and hand them to a small client adapter that owns the rest.

```tsx
// app/talks/page.tsx (Server Component)
import { cacheLife } from 'next/cache';
import { validateTalks } from '@wanderer/talks/helpers';
import { TalksClient } from './talks-client';
import { TALKS } from './talks-data';

// Under Cache Components, reading the clock during prerender is an error.
// A cached scope pins the snapshot and revalidates it on the cache profile.
async function getReferenceDate(): Promise<string> {
  'use cache';
  cacheLife('hours');
  return new Date().toISOString().slice(0, 10);
}

export default async function TalksPage() {
  const referenceDate = await getReferenceDate();
  const result = validateTalks(TALKS, { mode: 'strict' });
  if (!result.valid) throw new Error(JSON.stringify(result.errors));
  return <TalksClient talks={result.talks} referenceDate={referenceDate} />;
}
```

```tsx
// app/talks/talks-client.tsx (Client Component)
'use client';

import '@wanderer/talks/styles.css';
import Image from 'next/image';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Talks, type ImageComponentProps, type LinkComponentProps, type Talk, type Theme } from '@wanderer/talks';
import { globeView } from '@wanderer/talks/globe';

const views = [globeView({ presentation: 'immersive' })];

function NextLink({ href, children, ...rest }: LinkComponentProps) {
  return <Link href={href} {...rest}>{children}</Link>;
}

function NextImage({ src, alt, width, height, sizes, className }: ImageComponentProps) {
  return <Image src={src} alt={alt} width={width} height={height} sizes={sizes} className={className} />;
}

// Mirror the host's `dark` class on <html> into an explicit theme.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const getSnapshot = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
const getServerSnapshot = (): Theme => 'system';

export function TalksClient({ talks, referenceDate }: { talks: Talk[]; referenceDate: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <Talks
      talks={talks}
      referenceDate={referenceDate}
      theme={theme}
      views={views}
      responsive={{ small: 'list', large: 'globe' }}
      navigation={{ LinkComponent: NextLink }}
      ImageComponent={NextImage}
    />
  );
}
```

During server rendering the theme is `system`, so the stylesheet decides the palette. If your host already resolves the theme before hydration (an inline script that adds the `dark` class), set `data-wanderer-scheme="dark"` or `"light"` on `<html>` in that same script. The stylesheet reads the hint and paints the right palette before React runs, and after hydration `useColorScheme` reads the same hint under `theme="system"`, so the globe's default WebGL colors match too. See [docs/styling.md](docs/styling.md) and [docs/ssr.md](docs/ssr.md).

### Plain React without SSR

```tsx
import '@wanderer/talks/styles.css';
import { Talks, type TalksPlugin } from '@wanderer/talks';
import { talks } from './talks';

const keynotes: TalksPlugin = {
  id: 'keynotes',
  filters: [
    { id: 'keynote', label: 'Keynotes', predicate: (talk) => talk.tags?.includes('keynote') ?? false },
  ],
};

export function App() {
  return (
    <Talks
      talks={talks}
      referenceDate={new Date().toISOString().slice(0, 10)}
      plugins={[keynotes]}
      defaultFilters={['recording']}
      theme="system"
      density="compact"
    />
  );
}
```

## Documentation

- [docs/configuration.md](docs/configuration.md): every prop, controlled and uncontrolled state, responsive rules, reference date, grouping, search, validation, copy and localization.
- [docs/plugins.md](docs/plugins.md): the plugin contract with runnable examples.
- [docs/styling.md](docs/styling.md): tokens, class names, dark mode, RTL, data attributes.
- [docs/ssr.md](docs/ssr.md): server rendering, hydration, RSC boundaries, lazy globe loading.
- [docs/links.md](docs/links.md): the link model, validation, navigation.
- [docs/migration.md](docs/migration.md): moving from a site-specific talk shape.
- [docs/review.md](docs/review.md): comparison findings, fixes and source-data integration notes.
- [CHANGELOG.md](CHANGELOG.md)

## Compatibility

- React 18.2 and later, and React 19, per the peer range. The automated compatibility script (`scripts/react-compat.mjs` in the repository, not in the published package) packs the package, installs it into an isolated project per React version and runs a server render, hydration and interaction check. It exercises React 18.3.1 and the installed React 19 version. The packed list consumer also builds with React 18.2.0.
- Vite and Next.js App Router production builds are verified using isolated tarball installs, including RSC boundaries and CSS exports. See [examples](https://github.com/hrittikhere/wanderer/blob/main/examples/README.md).
- Browser verification is performed in Chromium via Playwright. Other browsers are not part of the automated run.
- The globe needs WebGL (WebGL2, WebGL or `experimental-webgl`). Without it the view shows a fallback with a button back to the list.

### Known limitations

These frameworks are untested. The notes describe what should happen based on how the package is built, not on verification.

- **Remix**: untested. The package is ESM and CommonJS with per-file `"use client"` directives, which Remix ignores harmlessly. The client adapter pattern above should work; keep `referenceDate` in the loader.
- **Astro**: untested. Use the React integration with `client:only="react"` or `client:load`. The globe checks browser APIs after hydration, so SSR does not require `client:only`; verify the chosen Astro integration in your app.
- **Create React App**: untested. `react-scripts` 5 resolves package `exports` maps only partially, so the subpath entries may need explicit paths. It has no `"use client"` handling, which is harmless. The CSS import works.

## Development and checks

```sh
npm ci
npm test                       # build, typecheck, unit tests and export checks
npm run test:compat            # isolated React SSR and hydration checks
npm run test:package           # packed Vite / Next builds and bundle budgets
npm ci --prefix examples/vite
npx playwright install chromium
npm run test:browser           # layout, focus, filters, WebGL fallback and axe
```

CI runs all four suites. Browser artifacts include traces on failure and milestone screenshots at 390, 768, 1366 and 1920 pixels. `test:package` enforces minified gzip budgets of 18 kB for the list and 30 kB for the globe including cobe, excluding React in both. `verify:dist` separately reports unminified module graph sizes.

## License

MIT. Copyright (c) 2026 Hrittik Roy. See [LICENSE](LICENSE).
