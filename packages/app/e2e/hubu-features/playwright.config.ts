import { defineConfig, devices } from "@playwright/test"
export default defineConfig({
  testDir: "../regression",
  testMatch: "hubu-*.spec.ts",
  outputDir: "../test-results/hubu-features",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 2,
  retries: 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4527",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev -- --host 127.0.0.1 --port 4527 --strictPort",
    url: "http://127.0.0.1:4527",
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      BRAND: "hubu",
      OPENCODE_CHANNEL: "hubu",
      VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
      VITE_OPENCODE_SERVER_PORT: "4096",
    },
  },
})
