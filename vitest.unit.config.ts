import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// PURE unit tests only: no database, no Supabase, no network, no .env files, no global setup. Safe to run anywhere (`npm test`, CI "unit" job).
// Anything needing PostgreSQL, GoTrue, PostgREST, Realtime or Mailpit lives in tests/db and runs with vitest.config.ts (`npm run test:db`).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/ai/stub-server-only.ts") } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}", "tests/ai/**/*.test.ts"], testTimeout: 20_000 },
});
