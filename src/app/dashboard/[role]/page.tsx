import { notFound } from "next/navigation";
import { AdminHome, DonorHome, RequesterHome } from "@/components/dashboard/real/views";
import { requireRole } from "@/lib/auth";
import { isRole } from "@/lib/nav";

export default async function RoleHome({ params }: PageProps<"/dashboard/[role]">) {
  const { role } = await params;
  if (!isRole(role)) notFound();
  const s = await requireRole(role);
  return role === "donor" ? <DonorHome s={s} /> : role === "requester" ? <RequesterHome s={s} /> : <AdminHome />;
}
