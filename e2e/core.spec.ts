import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 768, 1366, 1920]) {
  for (const direction of ['ltr', 'rtl']) {
    test(`core globe and milestone fit ${width}px ${direction}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/?dir=${direction}`);
      await expect(page.locator('.wanderer-globe')).toHaveAttribute('data-wanderer-globe-status', 'ready');
      await expect(page.locator('.wanderer-toolbar')).toHaveCount(0);
      await expect(page.locator('.wanderer-globe__panel')).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Milestones', exact: true }).selectOption('first-stage');
      const card = page.locator('.wanderer-globe__callout');
      await expect(card).toBeVisible();
      const stage = (await page.locator('.wanderer-globe__stage').boundingBox())!;
      const bounds = (await card.boundingBox())!;
      expect(stage.width).toBeGreaterThan(250);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      const beside = direction === 'rtl' ? bounds.x + bounds.width <= stage.x : bounds.x >= stage.x + stage.width;
      expect(bounds.y >= stage.y + stage.height || beside).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`core-${width}-${direction}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}

test('additions are independent and toggling them preserves the globe and milestone', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const canvas = page.locator('canvas.wanderer-globe__canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element) => element.setAttribute('data-core-canvas', 'original'));
  await page.getByRole('combobox', { name: 'Milestones', exact: true }).selectOption('first-stage');
  await page.getByRole('checkbox', { name: 'Enable sidebox', exact: true }).check();
  await expect(page.locator('.wanderer-globe__panel')).toBeVisible();
  await expect(page.locator('.wanderer-toolbar')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable search', exact: true }).check();
  await expect(page.getByRole('searchbox', { name: 'Search talks' })).toBeVisible();
  await expect(page.locator('.wanderer-filters')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable filters', exact: true }).check();
  await expect(page.getByRole('button', { name: 'With recording', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Enable result count', exact: true }).check();
  await expect(page.locator('.wanderer-toolbar__count')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Enable list view', exact: true }).check();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-core-canvas', 'original');
  await expect(page.locator('.wanderer-globe__callout')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Enable sidebox', exact: true }).uncheck();
  await expect(page.locator('.wanderer-globe__panel')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-core-canvas', 'original');
  await expect(page.locator('.wanderer-globe__callout')).toBeVisible();
});

test('core is accessible and WebGL fallback offers only enabled additions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('canvas.wanderer-globe__canvas')).toBeVisible();
  await page.getByRole('combobox', { name: 'Milestones', exact: true }).selectOption('first-stage');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.reload();
  await expect(page.getByText('The globe could not be shown', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the list', exact: true })).toHaveCount(0);
  await expect(page.getByText('Everything is in the list.', { exact: false })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable list view', exact: true }).check();
  await page.getByRole('button', { name: 'Open the list', exact: true }).click();
  await expect(page.locator('.wanderer-talk').first()).toBeVisible();
});
