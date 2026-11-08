import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { NewRequestView, NotificationsView, OpportunitiesView, ProfileView, RequestsView, Title, UsersView } from "@/components/dashboard/real/views";
import { requireRole } from "@/lib/auth";
import { isRole, NAV } from "@/lib/nav";

export default async function Section({ params }: PageProps<"/dashboard/[role]/[section]">) {
  const { role, section } = await params;
  const item = isRole(role) ? NAV[role].find((i) => i.slug === section) : undefined;
  if (!isRole(role) || !item) notFound();
  const s = await requireRole(role); // authorization is verified here, not only in the layout

  if (section === "profile") return <ProfileView s={s} />;
  if (section === "notifications") return <NotificationsView />;
  if (section === "opportunities") return <OpportunitiesView s={s} />;
  if (section === "new-request") return <NewRequestView s={s} />;
  if (section === "requests") return <RequestsView s={s} />;
  if (section === "users") return <UsersView />;
  return (
    <>
      <Title>{item.label}</Title>
      <Card className="py-12 text-center text-muted"><p className="font-semibold text-navy">Planned for a later stage</p><p className="mt-1">The database and permissions for this are already in place and tested; the screen follows.</p></Card>
    </>
  );
}
