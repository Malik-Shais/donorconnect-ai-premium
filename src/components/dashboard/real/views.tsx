import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Kpi, KpiGrid } from "@/components/dashboard/kpi";
import { AvailabilityToggle } from "@/components/dashboard/availability-toggle";
import { ProfileForm, RequestForm } from "@/components/dashboard/real/forms";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms";
import { canGiveTo, canReceiveFrom } from "@/lib/compat";
import { acceptRequestAction } from "@/app/actions/offers";
import { closeRequestAction } from "@/app/actions/requests";
import { markNotificationsReadAction, setAvailabilityAction } from "@/app/actions/profile";
import type { BloodRequest, Notification, Profile, Session } from "@/lib/types";

export const Title = ({ children }: { children: React.ReactNode }) => <h1 className="mb-5 text-3xl font-bold">{children}</h1>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl bg-offwhite px-4 py-6 text-center text-sm text-muted">{children}</p>;
const urgencyTone: Record<string, Tone> = { routine: "neutral", urgent: "urgent", critical: "critical" };
const statusTone: Record<string, Tone> = { open: "open", matched: "matched", fulfilled: "fulfilled", cancelled: "neutral" };
const date = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

function ReqRow({ r, close }: { r: Pick<BloodRequest, "id" | "blood_group" | "units" | "hospital" | "city" | "urgency" | "status" | "created_at"> & { patient_label?: string }; close?: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 min-w-12 place-items-center rounded-xl bg-burgundy px-2 font-display font-bold text-white" aria-label={`Blood group ${r.blood_group}`}>{r.blood_group}</span>
        <div><p className="font-semibold">{r.units} unit{r.units > 1 ? "s" : ""} · {r.hospital}</p><p className="text-sm text-muted">{r.city} · {date(r.created_at)}{r.patient_label ? ` · ${r.patient_label}` : ""}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={urgencyTone[r.urgency]}>{r.urgency}</Badge><Badge tone={statusTone[r.status]}>{r.status}</Badge>
        {close && (r.status === "open" || r.status === "matched") && (
          <>
            <form action={closeRequestAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="fulfilled" /><Button size="sm" variant="teal">Mark fulfilled</Button></form>
            <form action={closeRequestAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="cancelled" /><Button size="sm" variant="outline">Cancel</Button></form>
          </>
        )}
      </div>
    </li>
  );
}

type OpenReq = { id: number; blood_group: BloodRequest["blood_group"]; units: number; city: string; hospital: string; urgency: BloodRequest["urgency"]; status: BloodRequest["status"]; created_at: string; city_match: boolean; responded: boolean };
async function openRequests(): Promise<OpenReq[]> {
  const { data } = await (await createClient()).rpc("open_requests_for_donor");
  return (data ?? []) as OpenReq[];
}

export async function DonorHome({ s }: { s: Session }) {
  const d = s.donor!;
  const supabase = await createClient();
  const [open, accepted] = await Promise.all([openRequests(), count(supabase.from("offers").select("id", { count: "exact", head: true }).eq("status", "accepted"))]);
  const status = d.eligibility_status === "deferred" ? "On hold" : d.available ? "Active" : "Paused";
  return (
    <>
      <Title>Hello, {s.profile.full_name.split(" ")[0]}</Title>
      <KpiGrid><Kpi value={d.blood_group} label="Your blood group" /><Kpi value={status} label="Matching status" /><Kpi value={open.length} label="Requests you could help" /><Kpi value={accepted} label="Offers accepted" /></KpiGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle>Availability</CardTitle><AvailabilityToggle initial={d.available} save={setAvailabilityAction} />
          <p className="mt-4 rounded-xl bg-teal-soft p-3 text-sm text-teal-900">
            Eligibility status from your blood service: <b>{d.eligibility_status}</b>{d.eligibility_note ? ` (${d.eligibility_note})` : ""}. Whether you may donate is decided by healthcare professionals, never by this app.
          </p></Card>
        <Card><CardTitle>Preliminary compatibility</CardTitle>
          <p><b>Could go to:</b> {canGiveTo(d.blood_group).join(", ")}</p><p className="mt-1"><b>Could receive from:</b> {canReceiveFrom(d.blood_group).join(", ")}</p></Card>
        <Card className="lg:col-span-2"><CardTitle>Requests near you</CardTitle>
          {open.length ? <ul className="divide-y divide-line">{open.slice(0, 4).map((r) => <ReqRow key={r.id} r={r} />)}</ul> : <Empty>No compatible open requests right now. We&apos;ll notify you when one appears.</Empty>}
          {open.length > 0 && <Link href="/dashboard/donor/opportunities" className="mt-3 inline-block text-sm font-semibold text-teal underline">See all opportunities</Link>}
        </Card>
      </div>
    </>
  );
}

export async function RequesterHome({ s }: { s: Session }) {
  const { data } = await (await createClient()).from("blood_requests").select("id,blood_group,units,hospital,city,urgency,status,created_at,patient_label").order("created_at", { ascending: false }).limit(50);
  const list = (data ?? []) as BloodRequest[];
  const c = (st: string) => list.filter((r) => r.status === st).length;
  return (
    <>
      <Title>Hello, {s.profile.full_name.split(" ")[0]}</Title>
      <KpiGrid><Kpi value={c("open")} label="Open" /><Kpi value={c("matched")} label="Matched" /><Kpi value={c("fulfilled")} label="Fulfilled" /><Kpi value={c("cancelled")} label="Cancelled" /></KpiGrid>
      <Card><CardTitle>Recent requests</CardTitle>
        {list.length ? <ul className="divide-y divide-line">{list.slice(0, 5).map((r) => <ReqRow key={r.id} r={r} />)}</ul>
          : <Empty>You haven&apos;t posted a request yet. <Link className="font-semibold text-teal underline" href="/dashboard/requester/new-request">Create your first request</Link>.</Empty>}</Card>
    </>
  );
}

export async function AdminHome() {
  const supabase = await createClient();
  const n = (role: string) => count(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", role));
  const rs = (st: string) => count(supabase.from("blood_requests").select("id", { count: "exact", head: true }).eq("status", st));
  const [donors, requesters, availableDonors, open, matched, fulfilled] = await Promise.all([
    n("donor"), n("requester"), count(supabase.from("donor_profiles").select("user_id", { count: "exact", head: true }).eq("available", true)), rs("open"), rs("matched"), rs("fulfilled")]);
  return (
    <>
      <Title>Analytics</Title>
      <KpiGrid><Kpi value={donors} label="Donors" /><Kpi value={requesters} label="Requesters" /><Kpi value={availableDonors} label="Available donors" /><Kpi value={open + matched} label="Active requests" /></KpiGrid>
      <Card><CardTitle>Requests by status</CardTitle>
        <p className="text-sm text-muted">Open {open} · Matched {matched} · Fulfilled {fulfilled}</p>
        <p className="mt-3 text-sm text-muted">Charts and deeper analytics arrive in a later stage; these figures are live database counts.</p></Card>
    </>
  );
}

export function ProfileView({ s }: { s: Session }) {
  return (<><Title>Profile</Title><Card className="max-w-xl"><p className="mb-4 text-sm text-muted">Signed in as <b>{s.email}</b> · role <b>{s.profile.role}</b> (role changes are not possible from the app)</p><ProfileForm profile={s.profile} donor={s.donor} /></Card></>);
}

export function NewRequestView({ s }: { s: Session }) {
  return (<><Title>New blood request</Title><Card className="max-w-2xl"><RequestForm defaultCity={s.profile.city} /></Card></>);
}

export async function RequestsView({ s }: { s: Session }) {
  const { data } = await (await createClient()).from("blood_requests").select("id,blood_group,units,hospital,city,urgency,status,created_at,patient_label").order("created_at", { ascending: false }).limit(100);
  const list = (data ?? []) as BloodRequest[];
  return (
    <>
      <Title>{s.profile.role === "admin" ? "All requests" : "My requests"}</Title>
      <Card>{list.length ? <ul className="divide-y divide-line">{list.map((r) => <ReqRow key={r.id} r={r} close={s.profile.role === "requester"} />)}</ul> : <Empty>No requests yet.</Empty>}</Card>
    </>
  );
}

export async function UsersView() {
  const { data } = await (await createClient()).from("profiles").select("id,role,full_name,city,created_at").order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as (Pick<Profile, "id" | "role" | "full_name" | "city"> & { created_at: string })[];
  return (
    <>
      <Title>Users</Title>
      <Card className="overflow-x-auto">
        {rows.length ? (
          <table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">Name</th><th className="pr-4">Role</th><th className="pr-4">City</th><th>Joined</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((u) => (
              <tr key={u.id}><td className="py-2.5 pr-4 font-medium">{u.full_name}</td><td className="pr-4"><Badge tone={u.role === "admin" ? "critical" : u.role === "donor" ? "matched" : "open"}>{u.role}</Badge></td><td className="pr-4">{u.city}</td><td>{date(u.created_at)}</td></tr>))}</tbody></table>
        ) : <Empty>No users yet.</Empty>}
      </Card>
    </>
  );
}

export async function OpportunitiesView({ s }: { s: Session }) {
  const d = s.donor!;
  const open = await openRequests();
  return (
    <>
      <Title>Opportunities</Title>
      <p className="mb-4 text-sm text-muted">Preliminary matches by blood group and availability. Hospitals and blood services confirm real compatibility and your eligibility.</p>
      {!d.available || d.eligibility_status === "deferred"
        ? <Card><Empty>Matching is paused ({d.eligibility_status === "deferred" ? "your blood service has put your eligibility on hold" : "you are set as unavailable"}). <Link className="font-semibold text-teal underline" href="/dashboard/donor/profile">Update your profile</Link>.</Empty></Card>
        : open.length === 0 ? <Card><Empty>No compatible open requests right now.</Empty></Card>
        : <ul className="grid gap-3">{open.map((r) => (
            <li key={r.id}><Card><ul><ReqRow r={r} /></ul>
              {r.responded ? <p className="pt-1 text-sm font-semibold text-emerald-700">✓ You accepted this request.</p> : (
                <form action={acceptRequestAction} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="share" className="size-5 accent-burgundy" /> Share my phone &amp; email with this requester</label>
                  <SubmitButton size="sm">I can help</SubmitButton>
                </form>)}
            </Card></li>))}</ul>}
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
