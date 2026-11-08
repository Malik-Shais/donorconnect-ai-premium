import { defineConfig, devices } from "@playwright/test";

const launchOptions = { executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] };
export default defineConfig({
  testDir: "tests/e2e",
  webServer: { command: "npm run start -- -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60_000 },
  use: { baseURL: "http://localhost:3100", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions } },
  ],
});
