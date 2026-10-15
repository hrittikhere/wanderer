# Runnable integrations

Use the Node version in `.nvmrc`. From the repository root:

```sh
npm ci
npm run build
npm ci --prefix examples/vite
npm --prefix examples/vite run dev
```

The Vite app starts with the searchable list. Switch to Globe to try compact milestones, manual selection, pause, location expansion and fullscreen. It uses synthetic appearances, including repeated titles, mixed formats and a tall image. Source data is in `vite/src/data.ts`; a small workshop filter shows the plugin API.

For the Next.js App Router example:

```sh
npm ci --prefix examples/next
npm --prefix examples/next run dev
```

Its server page validates data, computes the reference date in a `'use cache'` scope (enabled by `cacheComponents: true` in `next.config.ts`, as the README pattern requires) and hands serializable props to a client adapter containing the globe and Next Link integration. Rebuild the library after changing `src/`.

`npm run test:package` installs a packed tarball into isolated copies of both apps, then builds them; the fixtures are removed after a passing run (set `WANDERER_KEEP_FIXTURES=1` to keep them). It also bundles a list-only consumer with no `cobe` installed. `npm run test:browser` runs the Vite app in Chromium; install the browser first with `npx playwright install chromium`.
