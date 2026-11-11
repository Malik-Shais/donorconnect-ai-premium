import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { isRole } from "@/lib/nav";

export default async function RoleLayout({ children, params }: LayoutProps<"/demo/[role]">) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  return <DashboardShell role={role} demo>{children}</DashboardShell>;
}
