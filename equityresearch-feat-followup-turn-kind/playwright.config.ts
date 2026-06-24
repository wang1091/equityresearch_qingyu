import { defineConfig } from "@playwright/test";

// Frontend UI E2E. Separate runner from vitest (`npx playwright test` / `npm run
// test:ui`), so it never runs in the normal unit suite or CI. It drives the REAL
// app — webServer below auto-starts `npm run dev` (full stack on :5003; the dev
// server loads .env itself, so the local LLM / FMP / data upstreams are used).
// Needs the local stack up (LM Studio etc.) for the streamed answer; screenshots
// are captured regardless so the rendered UI is always visible.
export default defineConfig({
  testDir: "./e2e",
  // Custom match so vitest (which globs **/*.{test,spec}.ts) never picks these up.
  testMatch: "**/*.pw.ts",
  timeout: 180_000, // streamed local-LLM answers are slow
  expect: { timeout: 90_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5003",
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5003",
    timeout: 120_000,
    reuseExistingServer: true, // reuse a dev server you already have running
  },
});
