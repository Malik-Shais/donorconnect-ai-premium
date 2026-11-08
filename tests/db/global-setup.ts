// Rate-limit counters are persistent by design, so start each test run with clean counters (development database only).
import { config } from "dotenv";
import { Client } from "pg";

export default async function setup() {
  config({ path: ".env.test.local", quiet: true });
  if (!process.env.TEST_DATABASE_URL) return;
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  await c.query("truncate public.rate_limits");
  await c.end();
}
