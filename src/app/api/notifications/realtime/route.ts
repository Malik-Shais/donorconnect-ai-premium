import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private" };

// Hands the browser the caller's OWN short-lived access token so it can join its private channel "notif:<own uid>".
// Trade-off (documented in the README): the session cookie is HttpOnly, but this token is readable by page scripts; the CSP limits that exposure.
// What the token can do is unchanged: everything is still enforced by RLS, and the channel policy only admits the owner's topic.
export async function GET() {
  const s = await getSession();
  if (!s || s.profile.suspended) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  const { data } = await (await createClient()).auth.getSession();
  if (!data.session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ url: supabaseUrl(), anonKey: supabaseAnonKey(), token: data.session.access_token, topic: `notif:${s.profile.id}` }, { headers: NO_STORE });
}
