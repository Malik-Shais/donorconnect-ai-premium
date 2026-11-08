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
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: v.full_name, city: v.city, phone: v.phone ?? null }).eq("id", session.profile.id);
  if (error) return { error: "We couldn't save your profile. Please try again." };
  if (session.profile.role === "donor") {
    if (!v.blood_group) return { fields: { blood_group: "Choose your blood group" } };
    const { error: e2 } = await supabase.from("donor_profiles")
      .update({ blood_group: v.blood_group, available: v.available, last_donation_date: v.last_donation_date ?? null }).eq("user_id", session.profile.id);
    if (e2) return { error: "We couldn't save your donor details. Please try again." };
  }
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

export async function markNotificationsReadAction() {
  const session = await requireSession();
  await (await createClient()).from("notifications").update({ is_read: true }).eq("user_id", session.profile.id).eq("is_read", false);
  revalidatePath("/dashboard", "layout");
}
