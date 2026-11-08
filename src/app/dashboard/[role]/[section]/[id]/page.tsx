import { notFound } from "next/navigation";
import { AdminRequestDetail, RequesterRequestDetail } from "@/components/dashboard/real/workflow-views";
import { requireRole } from "@/lib/auth";
import { isRole } from "@/lib/nav";

export default async function Detail({ params, searchParams }: PageProps<"/dashboard/[role]/[section]/[id]">) {
  const { role, section, id } = await params;
  const sp = await searchParams;
  if (!isRole(role) || section !== "requests" || !/^\d{1,12}$/.test(id)) notFound();
  await requireRole(role); // wrong role is bounced to its own dashboard; the database RLS still decides what rows exist
  if (role === "requester") return <RequesterRequestDetail id={Number(id)} submitted={sp.submitted === "1"} />;
  if (role === "admin") return <AdminRequestDetail id={Number(id)} />;
  notFound();
}
