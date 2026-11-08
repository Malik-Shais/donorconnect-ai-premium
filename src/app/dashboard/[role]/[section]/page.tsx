import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { NewRequestView, NotificationsPage, OpportunitiesView, ProfileView, RequestsView, Title } from "@/components/dashboard/real/views";
import { AdminDonors, AdminRequestsList, AdminReviewQueue, AdminUsers, DonorOffers } from "@/components/dashboard/real/workflow-views";
import { AssistantChat } from "@/components/assistant/chat";
import { requireRole } from "@/lib/auth";
import { isRole, NAV } from "@/lib/nav";

export default async function Section({ params, searchParams }: PageProps<"/dashboard/[role]/[section]">) {
  const { role, section } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const item = isRole(role) ? NAV[role].find((i) => i.slug === section) : undefined;
  if (!isRole(role) || !item) notFound();
  const s = await requireRole(role); // authorization is verified here, not only in the layout

  if (section === "assistant") return (<><Title>AI assistant</Title><AssistantChat role={role} userId={s.profile.id} /></>);
  if (section === "profile") return <ProfileView s={s} />;
  if (section === "notifications") return <NotificationsPage role={role} />;
  if (role === "donor" && section === "opportunities") return <OpportunitiesView s={s} group={one("group")} city={one("city")} />;
  if (role === "donor" && section === "offers") return <DonorOffers />;
  if (role === "requester" && section === "new-request") return <NewRequestView s={s} />;
  if (role === "requester" && section === "requests") return <RequestsView />;
  if (role === "admin" && section === "review") return <AdminReviewQueue />;
  if (role === "admin" && section === "requests") return <AdminRequestsList status={one("status")} />;
  if (role === "admin" && section === "users") return <AdminUsers me={s.profile.id} q={one("q")} />;
  if (role === "admin" && section === "donors") return <AdminDonors q={one("q")} />;
  return (
    <>
      <Title>{item.label}</Title>
      <Card className="py-12 text-center text-muted"><p className="font-semibold text-navy">Planned for a later stage</p><p className="mt-1">This screen arrives in a later stage (AI assistant and advanced reports).</p></Card>
    </>
  );
}
