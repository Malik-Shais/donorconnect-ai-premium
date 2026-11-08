import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/env";

// Next 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie and does an OPTIMISTIC redirect only;
// real authorization is re-checked in every page/action (src/lib/auth.ts) and finally by Postgres RLS.
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === "production" }));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser(); // validates the JWT with the auth server
  const { pathname, search } = request.nextUrl;
  if (!user && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|icons|manifest.webmanifest|sw.js|offline.html|.*\\.(?:svg|png|ico)$).*)"] };
