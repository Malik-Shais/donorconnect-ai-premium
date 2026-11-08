import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

// Stable, generic link used in emails: it carries no role or data, and sends the signed-in user to their own notification center.
export default async function NotificationsRedirect() {
  const s = await requireSession();
  redirect(`/dashboard/${s.profile.role}/notifications`);
}
