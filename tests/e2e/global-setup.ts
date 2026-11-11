// Rate-limit counters are persistent by design: start every browser run with clean counters (development database only).
import { config } from "dotenv";
import { Client } from "pg";

export default async function globalSetup() {
  config({ path: ".env.test.local", quiet: true });
  if (!process.env.TEST_DATABASE_URL) return;
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  await c.query("truncate public.rate_limits");
  // Isolation: emails queued by earlier runs/suites (e.g. invitations to leftover opted-in test donors) must not sit ahead of this run's rows.
  await c.query("update public.email_outbox set status='skipped' where status='pending'");
  await c.end();
}
