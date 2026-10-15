import { defineConfig } from '@playwright/test';

// A port of its own: Vite's defaults (5173 for dev, 4173 for preview) may be
// serving an older build locally, which reuseExistingServer would pick up.
const origin = 'http://127.0.0.1:4391';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: origin, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--enable-unsafe-swiftshader'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'npm --prefix examples/vite run dev -- --host 127.0.0.1 --port 4391 --strictPort', url: origin, reuseExistingServer: !process.env.CI },
});
