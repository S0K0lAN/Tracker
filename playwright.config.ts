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
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    env: {
      VITE_GOOGLE_CLIENT_ID: 'e2e-build-client.apps.googleusercontent.com',
    },
  },
})
