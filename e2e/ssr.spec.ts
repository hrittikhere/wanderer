// Server-rendered markup in a real browser: before any script runs, the
// stylesheet (or the inline rule for a custom breakpoint) shows exactly one
// responsive shell, and hydration then completes without warnings. jsdom
// cannot check either, because it does not evaluate media queries.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderToString } from 'react-dom/server';
import { test, expect, type Page } from '@playwright/test';
import { ssrApp, type SsrConfig } from './ssr/app.js';

let client = '';
let styles = '';

test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./ssr/client.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'error',
    // The development build of React reports hydration mismatches.
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  client = bundle.outputFiles[0].text;
  styles = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');
});

async function serve(page: Page, config: SsrConfig): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>Server rendered talks</title><style>${styles}</style></head>`
    + `<body><div id="root">${renderToString(ssrApp(config))}</div><script>window.wandererSsr = ${JSON.stringify(config)};</script></body></html>`;
  await page.route('**/ssr.html', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/ssr-client.js', (route) => route.fulfill({ contentType: 'text/javascript', body: client }));
  await page.goto('/ssr.html');
  return consoleErrors;
}

const cases = [
  { width: 1440, visible: 'large', hidden: 'small', view: 'globe' },
  { width: 390, visible: 'small', hidden: 'large', view: 'list' },
  { width: 1000, visible: 'small', hidden: 'large', view: 'list' },
  { width: 1000, breakpoint: 900, visible: 'large', hidden: 'small', view: 'globe' },
] as const;

for (const { width, visible, hidden, view, ...config } of cases) {
  const breakpoint = 'breakpoint' in config ? config.breakpoint : undefined;
  test(`server HTML at ${width}px${breakpoint ? ` with a ${breakpoint}px breakpoint` : ''} shows only the ${visible} shell and hydrates cleanly`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const consoleErrors = await serve(page, { breakpoint });
    await expect(page.locator(`.wanderer-shell--${hidden}`)).toBeHidden();
    await expect(page.locator(`.wanderer-shell--${visible}`)).toBeVisible();
    await page.addScriptTag({ url: '/ssr-client.js', type: 'module' });
    await expect(page.locator('.wanderer-shell')).toHaveCount(1);
    await expect(page.locator('.wanderer-shell--active')).toBeVisible();
    await expect(page.locator('.wanderer')).toHaveAttribute('data-wanderer-view', view);
    await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
    expect(await page.evaluate(() => window.wandererRecoverableErrors)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
