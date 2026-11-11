import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { timed } from "@/lib/perf";
import type { Role } from "@/lib/nav";
import type { DonorProfile, Profile, Session } from "@/lib/types";

/** Data Access Layer. The role ALWAYS comes from public.profiles (not writable by users), never from JWT metadata or URLs. */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  // getClaims() verifies the access token's signature locally against the project's cached public keys (no network call). Projects that still use a
  // shared-secret JWT fall back to a getUser() round trip inside the library, so behaviour is the same, only slower. The role, suspension and every
  // permission still come from Postgres (profiles + RLS) on each request, exactly as before.
  const { data: auth } = await timed("auth.claims", () => supabase.auth.getClaims());
  const claims = auth?.claims;
  if (!claims?.sub) return null;
  const { data } = await timed("auth.profile", async () => supabase.from("profiles").select("*, donor_profiles!user_id(*)").eq("id", claims.sub).maybeSingle());
  if (!data) return null;
  const { donor_profiles, ...profile } = data as Profile & { donor_profiles: DonorProfile | null };
  return { email: typeof claims.email === "string" ? claims.email : "", profile, donor: donor_profiles };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile.suspended) redirect("/suspended");
  return s;
}

/** Call from EVERY page and server action that is role-specific (layouts are not re-run on client navigation). */
export async function requireRole(role: Role): Promise<Session> {
  const s = await requireSession();
  if (s.profile.role !== role) redirect(`/dashboard/${s.profile.role}`); // wrong role: bounce to own dashboard
  return s;
}
