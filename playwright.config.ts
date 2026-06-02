import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:17999",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "npm run build && node --enable-source-maps dist/cli.js ui --from tests/fixtures/replay-offline.jsonl --port 17999",
    url: "http://127.0.0.1:17999/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
