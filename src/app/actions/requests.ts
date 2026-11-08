"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { closeRequestSchema, fieldErrors, requestSchema, type FormState } from "@/lib/validation";

export async function createRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireRole("requester");
  const parsed = requestSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values: Object.fromEntries([...fd].filter(([, v]) => typeof v === "string")) as Record<string, string> };
  const v = parsed.data;
  const { error } = await (await createClient()).from("blood_requests").insert({ ...v, needed_by: v.needed_by ?? null, note: v.note ?? null, requester_id: session.profile.id });
  if (error) return { error: "We couldn't post your request. Please try again." };
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/requester/requests");
}

export async function closeRequestAction(fd: FormData) {
  await requireRole("requester");
  const parsed = closeRequestSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return;
  // RLS additionally guarantees only the owner of an open/matched request can do this.
  await (await createClient()).from("blood_requests").update({ status: parsed.data.status }).eq("id", parsed.data.id);
  revalidatePath("/dashboard", "layout");
}
