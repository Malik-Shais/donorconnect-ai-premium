import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

export default async function DashboardIndex() {
  const s = await requireSession();
  redirect(`/dashboard/${s.profile.role}`);
}
