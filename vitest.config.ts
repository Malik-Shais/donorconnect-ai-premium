import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import path from "node:path";

// Integration config: needs the local stack (npm run db:up). With REQUIRE_SERVICES=1 a missing/unreachable service FAILS the run (tests/db/global-setup.ts).
const KEYS = ["TEST_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "MAILPIT_URL", "EMAIL_SMTP_URL", "RATE_LIMIT_SECRET"];
const pickEnv = () => Object.fromEntries(KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k] as string]));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/ai/stub-server-only.ts") } },
  test: {
    environment: "jsdom",
    include: ["tests/db/**/*.test.ts"], // service-backed suites only; pure unit tests are in vitest.unit.config.ts
    globalSetup: ["tests/db/global-setup.ts"],
    env: { ...loadEnv("test", process.cwd(), ""), ...pickEnv() }, // .env.local by default; explicitly exported variables win (used to verify an isolated stack)
    fileParallelism: false, // DB tests share one database
    testTimeout: 20_000,
  },
});
