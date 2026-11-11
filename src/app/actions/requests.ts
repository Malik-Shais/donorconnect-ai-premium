"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fieldErrors, requestSchema, type FormState } from "@/lib/validation";

export async function createRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireRole("requester");
  const values = Object.fromEntries([...fd].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const parsed = requestSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };
  const v = parsed.data;
  // Status is not insertable by users: the database forces 'pending_review' (RLS + default).
  const { data, error } = await (await createClient()).from("blood_requests").insert({ ...v, needed_by: v.needed_by ?? null, note: v.note ?? null, requester_id: session.profile.id }).select("id").single();
  if (error?.code === "PT429") return { error: error.message, values }; // database-enforced rate limit
  if (error || !data) return { error: "We couldn't submit your request. Please try again.", values };
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/requester/requests/${data.id}?submitted=1`);
}
