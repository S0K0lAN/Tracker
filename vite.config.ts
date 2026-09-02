import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const tauriDevHost = (globalThis as {
  process?: { env?: Record<string, string | undefined> }
}).process?.env?.TAURI_DEV_HOST?.trim()

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: tauriDevHost || '127.0.0.1',
    port: 4173,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          protocol: 'ws',
          host: tauriDevHost,
          port: 4174,
        }
      : undefined,
    watch: {
      ignored: [
        '**/.tooling/**',
        '**/src-tauri/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    testTimeout: 10_000,
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
