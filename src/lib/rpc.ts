import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Calls a SECURITY DEFINER function as the signed-in user. Business-rule errors (SQLSTATE P0001) are written to be
 *  user-safe and shown verbatim; everything else is replaced by a generic message so internals never leak. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<{ data?: T; error?: string }> {
  const { data, error } = await (await createClient()).rpc(fn, args);
  if (!error) return { data: data as T };
  if (error.code === "P0001") return { error: error.message };
  if (error.code === "42501" || error.code === "28000") return { error: "You are not allowed to do that." };
  return { error: "Something went wrong. Please try again." };
}
