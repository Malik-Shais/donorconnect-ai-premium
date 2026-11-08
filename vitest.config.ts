import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import path from "node:path";

const KEYS = ["TEST_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "MAILPIT_URL", "EMAIL_SMTP_URL"];
const pickEnv = () => Object.fromEntries(KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k] as string]));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/ai/stub-server-only.ts") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/db/**/*.test.ts", "tests/ai/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    env: { ...loadEnv("test", process.cwd(), ""), ...pickEnv() }, // .env.local by default; explicitly exported variables win (used to verify an isolated stack)
    fileParallelism: false, // DB tests share one database
    testTimeout: 20_000,
  },
});
