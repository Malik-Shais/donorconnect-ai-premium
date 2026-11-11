import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private" };

// Every read goes through the caller's own RLS-scoped client: realtime only says "something changed", this endpoint re-authorizes.
export async function GET() {
  const s = await getSession();
  if (!s || s.profile.suspended) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  const supabase = await createClient();
  const [list, unread] = await Promise.all([
    supabase.from("notifications").select("id,message,link,is_read,created_at,category").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false)]);
  if (list.error) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ items: list.data, unread: unread.count ?? 0 }, { headers: NO_STORE });
}
