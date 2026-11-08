"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

const schema = z.object({ id: z.coerce.number().int().positive(), share: z.preprocess((v) => v === "on", z.boolean()) });

/** Donor volunteers for a request. Eligibility/compatibility/availability are re-checked inside the accept_request SQL function. */
export async function acceptRequestAction(fd: FormData) {
  await requireRole("donor");
  const p = schema.safeParse(Object.fromEntries(fd));
  if (!p.success) return;
  await (await createClient()).rpc("accept_request", { p_request_id: p.data.id, p_share_contact: p.data.share });
  revalidatePath("/dashboard", "layout");
}
