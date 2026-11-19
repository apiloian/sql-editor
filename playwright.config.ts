import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:3031',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3031 --strictPort',
    env: { VITE_APP_API_BASE: 'https://api.example.test/editor-api/' },
    url: 'http://127.0.0.1:3031',
    reuseExistingServer: false,
  },
})
