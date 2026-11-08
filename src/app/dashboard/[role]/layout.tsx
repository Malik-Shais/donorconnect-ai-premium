import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { isRole } from "@/lib/nav";

export default async function RoleLayout({ children, params }: LayoutProps<"/dashboard/[role]">) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  return <DashboardShell role={role}>{children}</DashboardShell>;
}
