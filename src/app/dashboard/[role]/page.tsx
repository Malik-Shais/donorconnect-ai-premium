import { notFound } from "next/navigation";
import { AdminCharts } from "@/components/dashboard/admin-charts";
import { AvailabilityToggle } from "@/components/dashboard/availability-toggle";
import { Kpi, KpiGrid } from "@/components/dashboard/kpi";
import { RequestRow } from "@/components/dashboard/request-row";
import { Card, CardTitle } from "@/components/ui/card";
import { canGiveTo, canReceiveFrom } from "@/lib/compat";
import { devRequests } from "@/lib/dev-data";
import { isRole } from "@/lib/nav";

const Title = ({ children }: { children: React.ReactNode }) => <h1 className="mb-5 text-3xl font-bold">{children}</h1>;

export default async function RoleHome({ params }: PageProps<"/dashboard/[role]">) {
  const { role } = await params;
  if (!isRole(role)) notFound();

  if (role === "donor") {
    const mine = "O+" as const;
    return (
      <>
        <Title>Hello, Ayesha</Title>
        <KpiGrid><Kpi value={mine} label="Your blood group" /><Kpi value="Active" label="Matching status" /><Kpi value={devRequests.filter((r) => r.status === "open").length} label="Open requests nearby" /><Kpi value={2} label="Offers accepted" /></KpiGrid>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardTitle>Availability</CardTitle><AvailabilityToggle />
            <p className="mt-4 rounded-xl bg-teal-soft p-3 text-sm text-teal-900">Whether you may donate, and when, is decided by your blood service, never by this app. Update your status after you donate.</p></Card>
          <Card><CardTitle>Preliminary compatibility</CardTitle>
            <p><b>Could go to:</b> {canGiveTo(mine).join(", ")}</p><p className="mt-1"><b>Could receive from:</b> {canReceiveFrom(mine).join(", ")}</p></Card>
          <Card className="lg:col-span-2"><CardTitle>Requests near you</CardTitle><ul className="divide-y divide-line">{devRequests.filter((r) => r.status !== "fulfilled").map((r) => <RequestRow key={r.id} r={r} />)}</ul></Card>
        </div>
      </>
    );
  }
  if (role === "requester") {
    const c = (s: string) => devRequests.filter((r) => r.status === s).length;
    return (
      <>
        <Title>Hello, Sana</Title>
        <KpiGrid><Kpi value={c("open")} label="Open" /><Kpi value={c("matched")} label="Matched" /><Kpi value={c("fulfilled")} label="Fulfilled" /><Kpi value={5} label="Donors accepted" /></KpiGrid>
        <Card><CardTitle>Recent requests</CardTitle><ul className="divide-y divide-line">{devRequests.map((r) => <RequestRow key={r.id} r={r} />)}</ul></Card>
      </>
    );
  }
  return (
    <>
      <Title>Analytics</Title>
      <KpiGrid><Kpi value={20} label="Donors" /><Kpi value={3} label="Requesters" /><Kpi value={devRequests.length} label="Requests" /><Kpi value="25%" label="Fulfilment rate" /></KpiGrid>
      <AdminCharts />
    </>
  );
}
