/** Supabase is optional at build/preview time: without it, auth pages explain how to configure it and demo mode still works. */
export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const isSupabaseConfigured = () => Boolean(supabaseUrl() && supabaseAnonKey());

/** Only same-site relative paths may be used as post-login redirects (prevents open redirects). */
export function safeNext(next: unknown, fallback = "/dashboard"): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : fallback;
}
