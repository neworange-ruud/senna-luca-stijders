import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests against a deployed environment. They start no local services, so
 * `PRODUCTION_URL` must point at a real deployment. Everything here is
 * read-only: it never pairs a device and never touches an authoritative match.
 */
export default defineConfig({
  testDir: "tests/production",
  workers: 1,
  outputDir: "test-results/production",
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL:
      process.env.PRODUCTION_URL ?? "https://senna-luca-stijders.vercel.app",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
