# Review and integration notes

Reviewed against [the speaking-history page](https://hrittikhere.com/talks), its supplied screenshots and the repository on 13 October 2026. The screenshots are a visual reference; they do not establish which package revision the site deploys.

| Reference or failure | Change in this repository | Verification |
|---|---|---|
| Milestone photos dominate the globe in tight layouts. | Bounded thumbnails and callouts beside or below the stage, plus full-photo links, manual selection, pause and dismiss. | Browser bounds at 390, 768, 1366 and 1920px, with a portrait image; reduced-motion and queue regressions. |
| Fullscreen covers the search, filters and view heading. | The entire shell opens as a native dialog with an exit. Search announcements remain inside it. A globe-only configuration stays inline. | Real browser focus containment, Escape, search clearing and exit; unit fallback coverage. |
| The globe can become a black disk despite passing fake-GL tests. | Supply the missing cobe base-brightness value. The previously optional value became a NaN shader uniform. | Real WebGL finite-uniform and visible-pixel assertions. |
| The advertised cobe peer accepts incompatible major versions. | Require `^0.6.5` for globe consumers; explain the build-time requirement. | Packed globe consumer, actual browser renderer and isolated list install without cobe. |
| Node 20 CI disagrees with the installed toolchain and quoted test globs are not portable. | Explicit recursive test discovery and accurate Node engines. | CI matrix on supported Node 22 and 24 versions. |
| Hover/focus preload failures leak rejected promises. | Catch speculative load failures; the view still owns activation and fallback. | Rejected-preload regression. |
| A deferred controlled view change can steal focus from search. | Cancel the pending focus request when the visitor moves focus elsewhere. | Controlled-mode focus regression, plus accepted delayed changes. |
| Plugin and direct links bypass the normal URL gate. | Apply `safeUrl` before any anchor or custom router receives the URL. | Unsafe plugin-link regression and existing link policy suite. |
| Browser and framework claims were stronger than the committed checks. | Runnable Vite and Next.js examples, isolated packed builds, bundle budgets, Playwright and axe in CI. | Unit, React compatibility, consumer and browser jobs. |

## Applying the site data

The package contains no personal speaking data. Installing these changes does not update the source website or its content. The examples deliberately use synthetic appearances and images.

- Give each appearance a stable ID. Repeated talk titles at different events should remain separate records.
- Convert `DD/MM/YYYY` dates to ISO calendar dates in the adapter, then run strict validation. Pass one reference date consistently through SSR and hydration.
- Keep session categories such as workshop or meetup separate from attendance format. The Vite example uses a `workshop` tag and a filter plugin; `format` remains online, hybrid or in person.
- Normalize locations before coordinate lookup. Do not place an online appearance on the globe just because its event name mentions a city. Country-only locations need an explicit mapping decision. The displayed location count is the number of merged markers, not a count of countries.
- Preserve event, recording, slides and detail links separately. The referenced SREday London entry contains an event URL with trailing title text; repair that source record and verify the destination. This package rejects whitespace-containing URLs but cannot infer their intended destination.
- Keep invitations, contact details and current-location cards in site-owned slots. Place important controls outside decorative overlays so the globe remains usable on mobile.

See [migration.md](migration.md) for the adapter, [examples](../examples/README.md) for working integrations, and the root README for the four verification commands. Remix and Astro, mobile hardware GPUs and browsers other than Chromium still need host-specific verification.
