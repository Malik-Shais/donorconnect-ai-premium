"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, safeNext } from "@/lib/env";
import { fieldErrors, forgotSchema, loginSchema, registerSchema, resetSchema, type FormState } from "@/lib/validation";

const NOT_CONFIGURED: FormState = { error: "The backend is not configured yet. See the README (npm run db:up)." };
const keep = (fd: FormData, ...skip: string[]) => Object.fromEntries([...fd].filter(([k, v]) => typeof v === "string" && !skip.includes(k))) as Record<string, string>;

function friendly(e: AuthError): string {
  if (e.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  if (/invalid login/i.test(e.message)) return "Incorrect email or password.";
  if (/already registered|already been registered/i.test(e.message)) return "An account with this email already exists. Try signing in.";
  if (/weak|password/i.test(e.message)) return "Please choose a stronger password.";
  return "Something went wrong. Please try again.";
}

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = registerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values: keep(fd, "password") };
  const { email, password, role, full_name, city, phone, blood_group } = parsed.data;
  const supabase = await createClient();
  // Metadata is client-controlled by nature; the database trigger clamps the role to donor/requester regardless.
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { role, full_name, city, phone: phone ?? "", blood_group } } });
  if (error) return { error: error.status === 500 ? "We couldn't create your account. Please check your details." : friendly(error), values: keep(fd, "password") };
  if (!data.session) return { message: "Check your email to confirm your account, then sign in." };
  redirect("/dashboard");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = loginSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values: keep(fd, "password") };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: friendly(error), values: keep(fd, "password") };
  redirect(safeNext(fd.get("next")));
}

export async function logoutAction() {
  if (isSupabaseConfigured()) await (await createClient()).auth.signOut();
  redirect("/");
}

const GENERIC_RESET = "If an account exists for that email, we've sent password reset instructions.";
export async function forgotAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = forgotSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values: keep(fd) };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await createClient();
  // Same answer whether or not the account exists (no account enumeration). GoTrue validates redirectTo against its allow-list.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  return { message: GENERIC_RESET };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = resetSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Please request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: friendly(error) };
  redirect("/dashboard");
}
