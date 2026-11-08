import Link from "next/link";
import { Bell, CheckCheck, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { rpc } from "@/lib/rpc";
import { Kpi, KpiGrid } from "@/components/dashboard/kpi";
import { AvailabilityToggle } from "@/components/dashboard/availability-toggle";
import { InlineAction } from "@/components/dashboard/real/action-ui";
import { ProfileForm } from "@/components/dashboard/real/forms";
import { RequestWizard } from "@/components/dashboard/real/request-wizard";
import { StatusBadge } from "@/components/status-badge";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { GROUPS, canGiveTo, canReceiveFrom } from "@/lib/compat";
import { acceptRequestAction } from "@/app/actions/workflow";
import { markNotificationsReadAction, setAvailabilityAction } from "@/app/actions/profile";
import type { BloodRequest, Notification, OpenReq, RequestStatus, Session } from "@/lib/types";

export const Title = ({ children }: { children: React.ReactNode }) => <h1 className="mb-5 text-3xl font-bold">{children}</h1>;
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl bg-offwhite px-4 py-6 text-center text-sm text-muted">{children}</p>;
export const urgencyTone: Record<string, Tone> = { routine: "neutral", urgent: "urgent", critical: "critical" };
export const date = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
export const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
export const MEDICAL_NOTE = "Matching is preliminary (ABO/Rh red-cell reference only). Blood services and clinicians confirm real compatibility and decide who may donate. This app gives no medical advice.";

type RowReq = { id: number; blood_group: BloodRequest["blood_group"]; units: number; hospital: string; city: string; urgency: string; status: RequestStatus; created_at: string; patient_label?: string };
export function ReqRow({ r, href, extra }: { r: RowReq; href?: string; extra?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-center gap-3">
        <span className="grid h-9 min-w-12 place-items-center rounded-xl bg-burgundy px-2 font-display font-bold text-white" aria-label={`Blood group ${r.blood_group}`}>{r.blood_group}</span>
        <div><p className="font-semibold">{r.units} unit{r.units > 1 ? "s" : ""} · {r.hospital}</p><p className="text-sm text-muted">{r.city} · {date(r.created_at)}{r.patient_label ? ` · ${r.patient_label}` : ""}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5"><Badge tone={urgencyTone[r.urgency]}>{r.urgency}</Badge><StatusBadge status={r.status} />{extra}</div>
    </>
  );
  return <li>{href ? <Link href={href} className="flex flex-wrap items-center justify-between gap-3 rounded-xl py-3 hover:bg-offwhite sm:px-2">{body}</Link> : <div className="flex flex-wrap items-center justify-between gap-3 py-3">{body}</div>}</li>;
}

async function openRequests(): Promise<OpenReq[]> {
  return (await rpc<OpenReq[]>("open_requests_for_donor")).data ?? [];
}

export async function DonorHome({ s }: { s: Session }) {
  const d = s.donor!;
  const supabase = await createClient();
  const [open, accepted, invited] = await Promise.all([openRequests(),
    count(supabase.from("offers").select("id", { count: "exact", head: true }).eq("status", "accepted")),
    count(supabase.from("offers").select("id", { count: "exact", head: true }).eq("status", "invited"))]);
  const status = d.eligibility_status === "deferred" ? "On hold" : d.available ? "Active" : "Paused";
  return (
    <>
      <Title>Hello, {s.profile.full_name.split(" ")[0]}</Title>
      <KpiGrid><Kpi value={d.blood_group} label="Your blood group" /><Kpi value={status} label="Matching status" /><Kpi value={open.length} label="Requests you could help" /><Kpi value={accepted} label="Offers accepted" /></KpiGrid>
      {invited > 0 && <Link href="/dashboard/donor/offers" className="mb-5 block rounded-xl border border-coral/40 bg-coral/10 px-4 py-3 font-semibold text-burgundy">You have {invited} pending invitation{invited > 1 ? "s" : ""}. Review {invited > 1 ? "them" : "it"} →</Link>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle>Availability</CardTitle><AvailabilityToggle initial={d.available} save={setAvailabilityAction} />
          <p className="mt-4 rounded-xl bg-teal-soft p-3 text-sm text-teal-900">
            Eligibility status recorded from your blood service: <b>{d.eligibility_status}</b>{d.eligibility_note ? ` (${d.eligibility_note})` : ""}. Whether you may donate is decided by healthcare professionals, never by this app.
          </p></Card>
        <Card><CardTitle>Preliminary compatibility</CardTitle>
          <p><b>Could go to:</b> {canGiveTo(d.blood_group).join(", ")}</p><p className="mt-1"><b>Could receive from:</b> {canReceiveFrom(d.blood_group).join(", ")}</p></Card>
        <Card className="lg:col-span-2"><CardTitle>Requests near you</CardTitle>
          {open.length ? <ul className="divide-y divide-line">{open.slice(0, 4).map((r) => <ReqRow key={r.id} r={r} />)}</ul> : <Empty>No compatible approved requests right now. We&apos;ll notify you when one appears.</Empty>}
          {open.length > 0 && <Link href="/dashboard/donor/opportunities" className="mt-3 inline-block text-sm font-semibold text-teal underline">See all opportunities</Link>}
        </Card>
      </div>
    </>
  );
}

export async function RequesterHome({ s }: { s: Session }) {
  const { data } = await (await createClient()).from("blood_requests").select("id,blood_group,units,hospital,city,urgency,status,created_at,patient_label").order("created_at", { ascending: false }).limit(50);
  const list = (data ?? []) as RowReq[];
  const c = (st: RequestStatus) => list.filter((r) => r.status === st).length;
  return (
    <>
      <Title>Hello, {s.profile.full_name.split(" ")[0]}</Title>
      <KpiGrid><Kpi value={c("pending_review")} label="Pending review" /><Kpi value={c("approved")} label="Approved" /><Kpi value={c("matched")} label="Matched" /><Kpi value={c("fulfilled")} label="Fulfilled" /></KpiGrid>
      <Card><CardTitle>Recent requests</CardTitle>
        {list.length ? <ul className="divide-y divide-line">{list.slice(0, 5).map((r) => <ReqRow key={r.id} r={r} href={`/dashboard/requester/requests/${r.id}`} />)}</ul>
          : <Empty>You haven&apos;t posted a request yet. <Link className="font-semibold text-teal underline" href="/dashboard/requester/new-request">Create your first request</Link>.</Empty>}</Card>
    </>
  );
}

export async function AdminHome() {
  const supabase = await createClient();
  const n = (role: string) => count(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", role));
  const rs = (st: RequestStatus) => count(supabase.from("blood_requests").select("id", { count: "exact", head: true }).eq("status", st));
  const [donors, requesters, pending, approved, matched, fulfilled] = await Promise.all([n("donor"), n("requester"), rs("pending_review"), rs("approved"), rs("matched"), rs("fulfilled")]);
  return (
    <>
      <Title>Analytics</Title>
      {pending > 0 && <Link href="/dashboard/admin/review" className="mb-5 block rounded-xl border border-coral/40 bg-coral/10 px-4 py-3 font-semibold text-burgundy">{pending} request{pending > 1 ? "s are" : " is"} waiting for review →</Link>}
      <KpiGrid><Kpi value={donors} label="Donors" /><Kpi value={requesters} label="Requesters" /><Kpi value={pending} label="Awaiting review" /><Kpi value={approved + matched} label="Active requests" /></KpiGrid>
      <Card><CardTitle>Requests by status</CardTitle><p className="text-sm text-muted">Pending {pending} · Approved {approved} · Matched {matched} · Fulfilled {fulfilled}</p>
        <p className="mt-3 text-sm text-muted">Charts and deeper analytics arrive in a later stage; these are live database counts.</p></Card>
    </>
  );
}

export function ProfileView({ s }: { s: Session }) {
  return (<><Title>Profile</Title><Card className="max-w-xl"><p className="mb-4 text-sm text-muted">Signed in as <b>{s.email}</b> · role <b>{s.profile.role}</b> (roles cannot be changed from the app)</p><ProfileForm profile={s.profile} donor={s.donor} /></Card></>);
}

export function NewRequestView({ s }: { s: Session }) {
  return (<><Title>New blood request</Title><Card className="max-w-2xl"><RequestWizard defaultCity={s.profile.city} /></Card></>);
}

export async function RequestsView() {
  const { data } = await (await createClient()).from("blood_requests").select("id,blood_group,units,hospital,city,urgency,status,created_at,patient_label").order("created_at", { ascending: false }).limit(100);
  const list = (data ?? []) as RowReq[];
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold">My requests</h1><Button asChild size="sm"><Link href="/dashboard/requester/new-request">New request</Link></Button></div>
      <Card>{list.length ? <ul className="divide-y divide-line">{list.map((r) => <ReqRow key={r.id} r={r} href={`/dashboard/requester/requests/${r.id}`} />)}</ul> : <Empty>No requests yet.</Empty>}</Card>
    </>
  );
}

export async function OpportunitiesView({ s, group, city }: { s: Session; group?: string; city?: string }) {
  const d = s.donor!;
  const all = await openRequests();
  const q = (city ?? "").trim().toLowerCase();
  const open = all.filter((r) => (!group || r.blood_group === group) && (!q || r.city.toLowerCase().includes(q)));
  const paused = !d.available || d.eligibility_status === "deferred";
  return (
    <>
      <Title>Opportunities</Title>
      <p className="mb-4 flex gap-2 rounded-xl bg-teal-soft px-3.5 py-2.5 text-sm text-teal-900"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{MEDICAL_NOTE}</p>
      {paused ? <Card><Empty>Matching is paused ({d.eligibility_status === "deferred" ? "a blood service decision has put your eligibility on hold" : "you are set as unavailable"}). <Link className="font-semibold text-teal underline" href="/dashboard/donor/profile">Update your profile</Link>.</Empty></Card> : (
        <>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filter opportunities">
            <label className="grid gap-1 text-sm font-semibold text-navy">Blood group needed
              <select name="group" defaultValue={group ?? ""} className="min-h-11 rounded-xl border-[1.5px] border-line bg-white px-3 font-normal"><option value="">Any</option>{GROUPS.filter((g) => all.some((r) => r.blood_group === g)).map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-semibold text-navy">City
              <input name="city" defaultValue={city ?? ""} placeholder="Any city" className="min-h-11 rounded-xl border-[1.5px] border-line bg-white px-3 font-normal" /></label>
            <Button size="sm">Apply filters</Button>
            {(group || city) && <Link href="/dashboard/donor/opportunities" className="text-sm font-semibold text-teal underline">Clear</Link>}
          </form>
          {open.length === 0 ? <Card><Empty>{all.length ? "No requests match your filters." : "No compatible approved requests right now."}</Empty></Card> : (
            <ul className="grid gap-3" aria-label={`${open.length} opportunities`}>{open.map((r) => (
              <li key={r.id}><Card>
                <ul><ReqRow r={r} extra={r.city_match ? <Badge tone="matched">Your city</Badge> : null} /></ul>
                {r.offer_status === "accepted" ? <p className="pt-1 text-sm font-semibold text-emerald-700">✓ You accepted this request. <Link href="/dashboard/donor/offers" className="underline">Manage offer</Link></p>
                  : r.offer_status === "invited" ? <p className="pt-1 text-sm">You were invited. <Link className="font-semibold text-teal underline" href="/dashboard/donor/offers">Respond to the invitation</Link></p>
                  : <div className="border-t border-line pt-3"><InlineAction action={acceptRequestAction} fields={{ request: r.id }} label="I can help">
                      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="share" className="mt-0.5 size-5 accent-burgundy" /> Share my name, phone &amp; email with this requester (you can turn this off later)</label>
                    </InlineAction></div>}
              </Card></li>))}</ul>)}
        </>)}
    </>
  );
}

export async function NotificationsView() {
  const { data } = await (await createClient()).from("notifications").select("id,message,link,is_read,created_at").order("created_at", { ascending: false }).limit(50);
  const items = (data ?? []) as Notification[];
  const unread = items.some((i) => !i.is_read);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold">Notifications</h1>
        {unread && <form action={markNotificationsReadAction}><Button size="sm" variant="outline"><CheckCheck aria-hidden /> Mark all read</Button></form>}</div>
      {items.length ? <ul className="grid gap-3">{items.map((n) => (
        <li key={n.id} className={`flex items-start justify-between gap-3 rounded-2xl border bg-white p-4 shadow-card ${n.is_read ? "border-line" : "border-l-4 border-coral"}`}>
          <span>{n.link ? <Link href={n.link} className="hover:underline">{n.message}</Link> : n.message}</span><span className="shrink-0 text-xs text-muted">{date(n.created_at)}</span></li>))}</ul>
        : <Card><Empty><Bell className="mx-auto mb-2 size-6" aria-hidden />You&apos;re all caught up.</Empty></Card>}
    </>
  );
}
