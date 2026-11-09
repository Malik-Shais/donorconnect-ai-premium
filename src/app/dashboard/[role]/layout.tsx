import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isRole } from "@/lib/nav";

export default async function RoleLayout({ children, params }: LayoutProps<"/dashboard/[role]">) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  // The unread count is scoped to the caller by RLS, so it does not depend on the role check and runs alongside it.
  const [s, { count }] = await Promise.all([
    requireRole(role), // pages re-check too: layouts do not re-run on client-side navigation
    createClient().then((c) => c.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false))]);
  return <DashboardShell role={role} user={{ name: s.profile.full_name, email: s.email }} unread={count ?? 0}>{children}</DashboardShell>;
}
