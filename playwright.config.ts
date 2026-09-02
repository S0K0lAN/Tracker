import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Performance assertions share the same machine with Chrome. Serial workers
  // keep that gate deterministic instead of measuring contention from Axe runs.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      testIgnore: /mobile-shell\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: 'android-touch-smoke',
      testMatch: /mobile-shell\.spec\.ts/,
      use: {
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; PHK110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    env: {
      VITE_GOOGLE_CLIENT_ID: 'e2e-build-client.apps.googleusercontent.com',
    },
  },
})
