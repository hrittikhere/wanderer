import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('the real WebGL shader has finite uniforms and draws a visible globe', async ({ page }) => {
  await page.goto('/?presentation=immersive');
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  const canvas = page.locator('canvas.wanderer-globe__canvas');
  await expect(canvas).toBeVisible();
  const uniforms = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const gl = target.getContext('webgl2') ?? target.getContext('webgl');
    if (!gl) throw new Error('Real WebGL is required for this regression');
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const invalid: string[] = [];
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index += 1) {
      const info = gl.getActiveUniform(program, index)!;
      const value = gl.getUniform(program, gl.getUniformLocation(program, info.name)!);
      const numbers = typeof value === 'number' ? [value] : ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : [];
      if (numbers.some((number) => !Number.isFinite(number))) invalid.push(info.name);
    }
    return invalid;
  });
  expect(uniforms, 'NaN shader values previously turned the sphere black').toEqual([]);
  await expect.poll(() => canvas.evaluate((element) => new Promise<number>((resolve) => {
    requestAnimationFrame(() => {
      const sample = document.createElement('canvas');
      sample.width = sample.height = 64;
      const context = sample.getContext('2d')!;
      context.drawImage(element as HTMLCanvasElement, 0, 0, 64, 64);
      const { data } = context.getImageData(16, 16, 32, 32);
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] > 0 && data[index] > 15 && data[index] < 240) visible += 1;
      }
      resolve(visible);
    });
  }))).toBeGreaterThan(100);
});

test('search, workshop and upcoming filters combine and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search talks' }).fill('platforms');
  await expect(page.locator('.wanderer-talk')).toHaveCount(3);
  await page.getByRole('button', { name: 'Workshops', exact: true }).click();
  await expect(page.getByText('No talks match', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset search and filters', exact: true }).first().click();
  await page.getByRole('button', { name: 'Upcoming only', exact: true }).click();
  await expect(page.locator('.wanderer-talk')).toHaveCount(1);
  await expect(page.locator('.wanderer-talk')).toContainText('The next chapter');
  expect(errors).toEqual([]);
});

for (const width of [390, 768, 1366, 1920]) {
  test(`milestone stays clear of the globe at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Globe', exact: true }).click();
    await expect(page.locator('.wanderer-globe')).toHaveAttribute('data-wanderer-globe-status', 'ready');
    await page.getByRole('combobox', { name: 'Milestones', exact: true }).selectOption('first-stage');
    const card = page.locator('.wanderer-globe__callout');
    await expect(card).toBeVisible();
    const bounds = await card.boundingBox();
    const globe = await page.locator('.wanderer-globe__stage').boundingBox();
    expect(bounds).not.toBeNull();
    expect(globe).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(384);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y >= globe!.y + globe!.height || bounds!.x >= globe!.x + globe!.width).toBe(true);
    expect((await card.locator('img').boundingBox())!.height).toBeLessThanOrEqual(112);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`milestone-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Dismiss milestone' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Milestones', exact: true })).toHaveValue('');
  });
}

test('fullscreen keeps search, focus and exit inside the dialog', async ({ page }) => {
  await page.goto('/?presentation=immersive');
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Talks on the map' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('searchbox')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Talks on the map', exact: true })).toBeFocused();
  await dialog.getByRole('searchbox').fill('platforms');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('searchbox')).toHaveValue('');
  await expect(dialog.locator('[role="status"][aria-atomic="true"]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Exit fullscreen' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'All talks', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect(dialog).toHaveCount(0);
});

test('without WebGL, locations and the return to list stay usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind.includes('webgl')) return null;
      return original.call(this, kind as '2d', ...rest);
    } as typeof original;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await expect(page.getByText('The globe could not be shown', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Lisbon, Portugal/ }).click();
  await expect(page.locator('.wanderer-globe__location-panel:not([hidden])')).toContainText('Building reliable platforms');
  await page.getByRole('button', { name: 'Open the list', exact: true }).click();
  await expect(page.locator('.wanderer-talk')).toHaveCount(6);
});

for (const theme of ['light', 'dark']) {
  test(`list and fullscreen pass axe in ${theme} with RTL`, async ({ page }) => {
    await page.goto(`/?presentation=immersive&dir=rtl&theme=${theme}`);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Globe', exact: true }).click();
    await expect(page.locator('.wanderer-globe')).toHaveAttribute('data-wanderer-globe-status', 'ready');
    await page.getByRole('combobox', { name: 'Milestones', exact: true }).selectOption('first-stage');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
