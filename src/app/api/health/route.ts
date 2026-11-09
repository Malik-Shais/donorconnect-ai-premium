import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
const H = { "Cache-Control": "no-store" };

/** Liveness + dependency check for uptime monitors and deploy gates. Public by design, so it reveals nothing: no versions, hosts, keys or counts. */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: false, db: "not_configured" }, { status: 503, headers: H });
  try {
    // Hosted Supabase's gateway answers 401 without the (public) anon key, even for this health endpoint; found when verifying the staging project.
    const r = await fetch(`${supabaseUrl()}/auth/v1/health`, { headers: { apikey: supabaseAnonKey() }, signal: AbortSignal.timeout(3000), cache: "no-store" });
    return NextResponse.json({ ok: r.ok, db: r.ok ? "up" : "down" }, { status: r.ok ? 200 : 503, headers: H });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503, headers: H });
  }
}
