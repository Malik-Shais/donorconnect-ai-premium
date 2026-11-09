import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true }); config({ path: ".env.test.local", quiet: true }); // MAILPIT_URL etc. for the real-stack auth tests
const launchOptions = { executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] };
export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e/**/*.spec.ts", "live/**/*.live.spec.ts"],
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 2,
  // Shared GitHub runners (2 vCPU, running PostgreSQL + GoTrue + Next + two browsers) are several times slower than a developer machine: the multi-user
  // journey needs more than 30 s there and approval dialogs more than 5 s. Wider limits on CI only; NO retries, so a broken test still fails.
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  webServer: { command: "npm run start -- -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60_000,
    // MOCK Gemini for automated tests (needs BOTH flags). Live Gemini is verified separately by tests/live/gemini.live.spec.ts.
    env: process.env.DC_LIVE ? {} : { AI_PROVIDER: "mock", DC_ALLOW_AI_MOCK: "1" } },
  use: { baseURL: "http://localhost:3100", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions } },
  ],
});
