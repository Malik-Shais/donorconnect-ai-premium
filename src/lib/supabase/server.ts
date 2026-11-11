import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Per-request Supabase client acting AS THE SIGNED-IN USER (anon key + user JWT), so Postgres RLS applies.
 *  The service-role key is deliberately never used by the web app. */
export async function createClient(headers?: Record<string, string>) {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    ...(headers && { global: { headers } }),
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try { list.forEach(({ name, value, options }) => store.set(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === "production" })); }
        catch { /* called from a Server Component: proxy.ts refreshes the session instead */ }
      },
    },
  });
}
