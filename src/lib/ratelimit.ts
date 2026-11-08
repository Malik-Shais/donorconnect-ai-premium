import "server-only";
import { createHash } from "node:crypto";
import { limiterSecret } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Persistent, multi-process-safe limits live in PostgreSQL (anon_rate_limit). Subjects are SHA-256 hashes of the lower-cased email,
// plus a global ceiling per flow. Client IP headers are deliberately NOT used: they are spoofable unless a trusted proxy is configured.
const hash = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
const wait = (s: number) => (s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`);
export const tooMany = (seconds: number) => `Too many attempts. Please try again in ${wait(seconds)}.`;

/** Returns a user-facing message when blocked, otherwise null. Fails CLOSED if the limiter itself errors. */
export async function anonLimit(action: string, subject: string, count = true): Promise<string | null> {
  const { data, error } = await (await createClient({ "x-limiter-secret": limiterSecret() })).rpc("anon_rate_limit", { p_action: action, p_subject: hash(subject), p_count: count });
  if (error) return "Please try again in a moment.";
  return (data as number) > 0 ? tooMany(data as number) : null;
}
export const globalLimit = (action: string) => anonLimit(`${action}.global`, "global");
