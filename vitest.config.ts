import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/db/**/*.test.ts"],
    env: loadEnv("test", process.cwd(), ""), // picks up TEST_DATABASE_URL from .env.local
    fileParallelism: false, // DB tests share one database
    testTimeout: 20_000,
  },
});
