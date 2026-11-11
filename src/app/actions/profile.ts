"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { fieldErrors, profileSchema, type FormState } from "@/lib/validation";

export async function updateProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = profileSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };
  const v = parsed.data;
  if (session.profile.role === "donor" && !v.blood_group) return { fields: { blood_group: "Choose your blood group" } }; // validate before any write
  const supabase = await createClient();
  const lim = await supabase.rpc("check_rate_limit", { p_action: "profile.update" });
  if (lim.error) return { error: lim.error.code === "PT429" ? lim.error.message : "Please try again in a moment." };
  // the two tables are independent rows, so both updates run at the same time (one network round trip instead of two)
  const [base, donor] = await Promise.all([
    supabase.from("profiles").update({ full_name: v.full_name, city: v.city, phone: v.phone ?? null }).eq("id", session.profile.id),
    session.profile.role === "donor"
      ? supabase.from("donor_profiles").update({ blood_group: v.blood_group, available: v.available, last_donation_date: v.last_donation_date ?? null, notify_new_requests: v.notify_new_requests }).eq("user_id", session.profile.id)
      : Promise.resolve({ error: null })]);
  if (base.error) return { error: "We couldn't save your profile. Please try again." };
  if (donor.error) return { error: "We couldn't save your donor details. Please try again." };
  revalidatePath("/dashboard", "layout");
  return { message: "Profile saved." };
}

export async function setAvailabilityAction(available: boolean): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (session.profile.role !== "donor") return { ok: false };
  const { error } = await (await createClient()).from("donor_profiles").update({ available: Boolean(available) }).eq("user_id", session.profile.id);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

