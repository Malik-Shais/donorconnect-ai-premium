"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { FormState } from "@/lib/validation";

const id = z.coerce.number().int().positive();
export const CATEGORIES = ["request", "offer", "invitation", "review", "account"] as const;

export async function markNotificationReadAction(raw: number): Promise<{ ok: boolean }> {
  const s = await requireSession();
  const p = id.safeParse(raw); if (!p.success) return { ok: false };
  const { error } = await (await createClient()).from("notifications").update({ is_read: true }).eq("id", p.data).eq("user_id", s.profile.id);
  return { ok: !error };
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  const s = await requireSession();
  const { error } = await (await createClient()).from("notifications").update({ is_read: true }).eq("user_id", s.profile.id).eq("is_read", false);
  return { ok: !error };
}

const prefs = z.object({ email_enabled: z.preprocess((v) => v === "on", z.boolean()), cats: z.array(z.enum(CATEGORIES)) });
export async function saveNotificationPrefsAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const p = prefs.safeParse({ email_enabled: fd.get("email_enabled"), cats: fd.getAll("cat") });
  if (!p.success) return { error: "Choose valid notification categories." };
  const allowed = s.profile.role === "admin" ? CATEGORIES : CATEGORIES.filter((c) => c !== "review"); // only admins receive review-queue notices
  const cats = p.data.cats.filter((c) => (allowed as readonly string[]).includes(c));
  const supabase = await createClient();
  // update-then-insert (an upsert would need UPDATE on the key column, which is intentionally not granted)
  const upd = await supabase.from("notification_preferences").update({ email_enabled: p.data.email_enabled, email_categories: cats }).eq("user_id", s.profile.id).select("user_id");
  if (upd.error) return { error: "We couldn't save your settings. Please try again." };
  if (!upd.data?.length) {
    const ins = await supabase.from("notification_preferences").insert({ user_id: s.profile.id, email_enabled: p.data.email_enabled, email_categories: cats });
    if (ins.error) return { error: "We couldn't save your settings. Please try again." };
  }
  revalidatePath("/dashboard", "layout");
  return { message: p.data.email_enabled ? "Email notifications are on for the selected categories." : "Email notifications are off. You will still see everything in the app." };
}
