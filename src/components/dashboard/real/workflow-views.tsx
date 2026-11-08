import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { rpc } from "@/lib/rpc";
import { ActionDialog, InlineAction } from "@/components/dashboard/real/action-ui";
import { Empty, MEDICAL_NOTE, ReqRow, Title, date, urgencyTone } from "@/components/dashboard/real/views";
import { OfferBadge, REQUEST_LABEL, STATUS_HELP, StatusBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/forms";
import { inviteDonorsAction, moderateCancelAction, recordEligibilityAction, respondInvitationAction, reviewRequestAction, setConsentAction, setSuspendedAction, transitionRequestAction, withdrawOfferAction } from "@/app/actions/workflow";
import type { BloodRequest, MyOffer, OwnerOffer, RequestEvent, RequestStatus } from "@/lib/types";

const METHODS: Record<string, string> = { hospital_call: "Called the hospital / blood bank", hospital_document: "Reviewed a hospital document", known_requester: "Known, previously verified requester", other: "Other" };
const LIVE: RequestStatus[] = ["pending_review", "approved", "matched"];
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const Back = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal underline"><ArrowLeft className="size-4" aria-hidden />{children}</Link>;

function Summary({ r }: { r: BloodRequest }) {
  const rows: [string, string | null][] = [["Blood group", r.blood_group], ["Units", String(r.units)], ["City", r.city], ["Hospital / blood bank", r.hospital], ["Urgency", r.urgency],
    ["Needed by", r.needed_by ? new Date(r.needed_by).toLocaleDateString() : null], ["Patient alias", r.patient_label], ["Note", r.note]];
  return <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>;
}

const ReviewDialogs = ({ id }: { id: number }) => (
  <>
    <ActionDialog action={reviewRequestAction} fields={{ id, decision: "approve" }} trigger="Approve…" triggerVariant="teal" title="Approve this request?" confirm="Approve and notify donors" variant="teal"
      description="Approving publishes the request to preliminarily matching donors in the same city. Only approve after you have verified it." noteLabel="Note for the requester">
      <label className="grid gap-1.5 text-sm font-semibold text-navy">How was it verified?
        <Select name="method" defaultValue=""><option value="" disabled>Select…</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="verified" className="mt-0.5 size-5 accent-burgundy" /> I verified this request (not just its form fields).</label>
    </ActionDialog>
    <ActionDialog action={reviewRequestAction} fields={{ id, decision: "reject" }} trigger="Reject…" title="Reject this request?" confirm="Reject request"
      description="The requester will see your reason. Donors are never notified about rejected requests." noteLabel="Reason shown to the requester" noteRequired />
  </>
);

export async function RequesterRequestDetail({ id, submitted }: { id: number; submitted?: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("blood_requests").select("*").eq("id", id).maybeSingle();
  if (!data) notFound(); // also what another user's request id returns: RLS hides it
  const r = data as BloodRequest;
  const [{ data: ev }, offers] = await Promise.all([
    supabase.from("request_events").select("status,note,created_at").eq("request_id", id).order("id"),
    rpc<OwnerOffer[]>("owner_request_offers", { p_request_id: id })]);
  const list = offers.data ?? [], shared = list.some((o) => o.contact_shared), active = r.status === "approved" || r.status === "matched";
  return (
    <>
      <Back href="/dashboard/requester/requests">All requests</Back>
      {submitted && <p role="status" className="mb-4 rounded-xl border border-teal/30 bg-teal-soft px-4 py-3 text-sm text-teal-900"><b>Request submitted.</b> An administrator will verify it. No donor is notified until it is approved.</p>}
      <div className="mb-5 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">{r.blood_group} · {r.hospital}</h1><StatusBadge status={r.status} /><Badge tone={urgencyTone[r.urgency]}>{r.urgency}</Badge></div>
      <p className="mb-5 rounded-xl bg-white p-4 text-sm shadow-card">{STATUS_HELP[r.status]}{r.status === "rejected" && r.review_note ? <> <b>Reason:</b> {r.review_note}</> : null}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle>Details</CardTitle><Summary r={r} /></Card>
        <Card><CardTitle>Actions</CardTitle>
          <div className="grid gap-4">
            {active && <div><InlineAction action={inviteDonorsAction} fields={{ id }} label="Invite matching donors" variant="teal" /><p className="mt-2 text-xs text-muted">Invites up to 20 preliminary matches. They stay anonymous to you until they accept and consent.</p></div>}
            <div className="flex flex-wrap gap-2">
              {r.status === "matched" && <ActionDialog action={transitionRequestAction} fields={{ id, to: "fulfilled" }} trigger="Mark fulfilled" triggerVariant="teal" title="Mark this request fulfilled?" confirm="Mark fulfilled" variant="teal"
                description="Use this once the blood need has been met. Donor contact details will no longer be shown." noteLabel="Note" />}
              {LIVE.includes(r.status) && <ActionDialog action={transitionRequestAction} fields={{ id, to: "cancelled" }} trigger="Cancel request" title="Cancel this request?" confirm="Cancel request"
                description="Donors who accepted or were invited will be told. This cannot be undone." noteLabel="Reason" />}
              {!LIVE.includes(r.status) && <p className="text-sm text-muted">No further actions: this request is closed.</p>}
            </div>
          </div></Card>
        <Card className="lg:col-span-2"><CardTitle>Donor responses</CardTitle>
          {shared && <p className="mb-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />Shared with the donor&apos;s consent for this request only. Please use these details only to coordinate this donation. The donor can turn sharing off at any time; information you have already seen or copied cannot be recalled.</p>}
          {list.length ? <ul className="grid gap-3">{list.map((o) => (
            <li key={o.offer_id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{o.contact_shared ? o.donor_name : "Anonymous donor"} <span className="font-normal text-muted">· {o.blood_group} · {o.donor_city}</span></p><OfferBadge status={o.status} /></div>
              {o.contact_shared ? <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {o.phone ? <a className="inline-flex items-center gap-1.5 font-semibold text-teal underline" href={`tel:${o.phone}`}><Phone className="size-4" aria-hidden />{o.phone}</a> : <span className="text-muted">No phone provided</span>}
                {o.email && <a className="inline-flex items-center gap-1.5 font-semibold text-teal underline" href={`mailto:${o.email}`}><Mail className="size-4" aria-hidden />{o.email}</a>}</p>
                : <p className="mt-1 text-sm text-muted">{o.status === "accepted" ? (active ? "This donor chose not to share contact details (or turned sharing off)." : "Contact details are hidden because the request is closed.") : o.status === "invited" ? "Invited. Waiting for a response." : "No contact details."}</p>}
            </li>))}</ul> : <Empty>No donor has responded yet.{active ? " Try inviting matching donors." : ""}</Empty>}
        </Card>
        <Card className="lg:col-span-2"><CardTitle>Activity</CardTitle><Timeline events={(ev ?? []) as RequestEvent[]} /></Card>
      </div>
    </>
  );
}

type QueueReq = BloodRequest & { requester: { full_name: string; city: string } | null };
export async function AdminReviewQueue() {
  const { data } = await (await createClient()).from("blood_requests").select("*, requester:profiles!requester_id(full_name, city)").eq("status", "pending_review").order("created_at");
  const list = (data ?? []) as unknown as QueueReq[];
  return (
    <>
      <Title>Review queue</Title>
      <p className="mb-4 text-sm text-muted">Verify each request before approving. Donors are notified only after approval; rejected requests are never shown to donors.</p>
      {list.length === 0 ? <Card><Empty>Nothing is waiting for review. 🎉</Empty></Card> : (
        <ul className="grid gap-4">{list.map((r) => (
          <li key={r.id}><Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="font-display text-xl font-bold">{r.blood_group} · {r.units} unit{r.units > 1 ? "s" : ""} · {r.hospital}</p><span className="text-xs text-muted">Submitted {fmt(r.created_at)}</span></div>
            <Summary r={r} />
            <p className="mt-3 text-sm text-muted">Requester: <b>{r.requester?.full_name}</b> ({r.requester?.city})</p>
            <div className="mt-4 flex flex-wrap gap-2"><ReviewDialogs id={r.id} /><Button asChild size="sm" variant="ghost"><Link href={`/dashboard/admin/requests/${r.id}`}>Full details</Link></Button></div>
          </Card></li>))}</ul>)}
    </>
  );
}

export async function AdminRequestsList({ status }: { status?: string }) {
  let q = (await createClient()).from("blood_requests").select("id,blood_group,units,hospital,city,urgency,status,created_at,patient_label").order("created_at", { ascending: false }).limit(200);
  if (status && status in REQUEST_LABEL) q = q.eq("status", status);
  const list = ((await q).data ?? []) as { id: number; blood_group: BloodRequest["blood_group"]; units: number; hospital: string; city: string; urgency: string; status: RequestStatus; created_at: string; patient_label: string }[];
  return (
    <>
      <Title>All requests</Title>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {[["", "All"], ...Object.entries(REQUEST_LABEL)].map(([k, v]) => <Link key={k} href={k ? `/dashboard/admin/requests?status=${k}` : "/dashboard/admin/requests"} aria-current={(status ?? "") === k ? "page" : undefined}
          className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${(status ?? "") === k ? "border-burgundy bg-burgundy text-white" : "border-line bg-white text-navy hover:border-coral"}`}>{v}</Link>)}
      </nav>
      <Card>{list.length ? <ul className="divide-y divide-line">{list.map((r) => <ReqRow key={r.id} r={r} href={`/dashboard/admin/requests/${r.id}`} />)}</ul> : <Empty>No requests with this status.</Empty>}</Card>
    </>
  );
}

export async function AdminRequestDetail({ id }: { id: number }) {
  const supabase = await createClient();
  const { data } = await supabase.from("blood_requests").select("*, requester:profiles!requester_id(full_name, city)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as unknown as QueueReq;
  const [{ data: ev }, { data: audit }, offers] = await Promise.all([
    supabase.from("request_events").select("status,note,created_at").eq("request_id", id).order("id"),
    supabase.from("audit_logs").select("action,created_at,detail").eq("entity", "blood_requests").eq("entity_id", String(id)).order("id"),
    rpc<OwnerOffer[]>("owner_request_offers", { p_request_id: id })]);
  const offerList = offers.data ?? [];
  return (
    <>
      <Back href="/dashboard/admin/requests">All requests</Back>
      <div className="mb-5 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">{r.blood_group} · {r.hospital}</h1><StatusBadge status={r.status} /></div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle>Details</CardTitle><Summary r={r} /><p className="mt-3 text-sm text-muted">Requester: <b>{r.requester?.full_name}</b> ({r.requester?.city})</p>
          {r.reviewed_at && <p className="mt-2 text-sm text-muted">Reviewed {fmt(r.reviewed_at)}{r.verification_method ? ` · ${METHODS[r.verification_method]}` : ""}{r.review_note ? ` · “${r.review_note}”` : ""}</p>}</Card>
        <Card><CardTitle>Moderation</CardTitle>
          <div className="flex flex-wrap gap-2">
            {r.status === "pending_review" && <ReviewDialogs id={id} />}
            {LIVE.includes(r.status) && <ActionDialog action={moderateCancelAction} fields={{ id }} trigger="Cancel (moderation)" title="Cancel this request?" confirm="Cancel request"
              description="The requester and any involved donors are notified. Your note is shown to the requester and recorded in the audit log." noteLabel="Moderation note" noteRequired />}
            {!LIVE.includes(r.status) && <p className="text-sm text-muted">This request is closed. No further actions.</p>}
          </div>
          <p className="mt-3 text-xs text-muted">Administrators never see donor contact details.</p></Card>
        <Card><CardTitle>Donor responses ({offerList.length})</CardTitle>
          {offerList.length ? <ul className="grid gap-2 text-sm">{offerList.map((o) => <li key={o.offer_id} className="flex items-center justify-between gap-2"><span>Donor · {o.blood_group} · {o.donor_city} · {o.origin}</span><OfferBadge status={o.status} /></li>)}</ul> : <Empty>No responses.</Empty>}</Card>
        <Card><CardTitle>Request history</CardTitle><Timeline events={(ev ?? []) as RequestEvent[]} /></Card>
        <Card className="lg:col-span-2"><CardTitle>Audit log</CardTitle>
          {audit?.length ? <ul className="divide-y divide-line text-sm">{audit.map((a, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span><code className="rounded bg-offwhite px-1.5 py-0.5">{a.action}</code> {a.detail ? <span className="text-muted">{JSON.stringify(a.detail)}</span> : null}</span><span className="text-xs text-muted">{fmt(a.created_at)}</span></li>)}</ul> : <Empty>No audit entries.</Empty>}</Card>
      </div>
    </>
  );
}

/** Escape LIKE wildcards so a search for "100%" cannot match everything. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
function Search({ q, placeholder }: { q?: string; placeholder: string }) {
  return (
    <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm font-semibold text-navy">Search by name<input name="q" defaultValue={q ?? ""} placeholder={placeholder} maxLength={60} className="min-h-11 w-64 max-w-full rounded-xl border-[1.5px] border-line bg-white px-3 font-normal" /></label>
      <Button size="sm">Search</Button>{q && <Link href="?" className="pb-2 text-sm font-semibold text-teal underline">Clear</Link>}
    </form>
  );
}

type UserRow = { id: string; role: string; full_name: string; city: string; suspended: boolean; suspended_reason: string | null; created_at: string };
export async function AdminUsers({ me, q }: { me: string; q?: string }) {
  let query = (await createClient()).from("profiles").select("id,role,full_name,city,suspended,suspended_reason,created_at").order("created_at", { ascending: false }).limit(100);
  if (q?.trim()) query = query.ilike("full_name", like(q.trim()));
  const { data } = await query;
  const rows = (data ?? []) as UserRow[];
  return (
    <>
      <Title>Users</Title>
      <p className="mb-4 text-sm text-muted">Suspending removes a person&apos;s ability to act in the app immediately. Every action is audited. Donor eligibility is managed on the <Link href="/dashboard/admin/donors" className="font-semibold text-teal underline">Eligibility</Link> page. Showing the 100 newest matches.</p>
      <Search q={q} placeholder="e.g. Ayesha" />
      <Card className="relative overflow-x-auto" role="region" aria-label="Table" tabIndex={0}>
        {rows.length ? <table className="w-full min-w-[34rem] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">Name</th><th className="pr-4">Role</th><th className="pr-4">City</th><th className="pr-4">Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((u) => (
            <tr key={u.id}><td className="py-2.5 pr-4 font-medium">{u.full_name}{u.suspended && <Badge tone="critical" className="ml-2">suspended</Badge>}</td>
              <td className="pr-4"><Badge tone={u.role === "admin" ? "critical" : u.role === "donor" ? "matched" : "open"}>{u.role}</Badge></td><td className="pr-4">{u.city}</td><td className="pr-4">{date(u.created_at)}</td>
              <td className="text-right">{u.role !== "admin" && u.id !== me && (u.suspended
                ? <InlineAction action={setSuspendedAction} fields={{ user: u.id, suspended: "false" }} label="Restore" variant="outline" className="inline-grid" />
                : <ActionDialog action={setSuspendedAction} fields={{ user: u.id, suspended: "true" }} trigger="Suspend…" title={`Suspend ${u.full_name}?`} confirm="Suspend account"
                    description="They will immediately lose the ability to create requests, respond to requests or act in the app." noteLabel="Reason" noteRequired />)}</td></tr>))}</tbody></table> : <Empty>No users yet.</Empty>}
      </Card>
    </>
  );
}

type DonorRow = { user_id: string; blood_group: string; available: boolean; eligibility_status: string; eligibility_note: string | null; eligibility_source: string | null; eligibility_recorded_at: string | null; profile: { full_name: string; city: string } | null };
export async function AdminDonors({ q }: { q?: string }) {
  let query = (await createClient()).from("donor_profiles").select("user_id,blood_group,available,eligibility_status,eligibility_note,eligibility_source,eligibility_recorded_at, profile:profiles!user_id!inner(full_name, city)").order("updated_at", { ascending: false }).limit(100);
  if (q?.trim()) query = query.ilike("profile.full_name", like(q.trim()));
  const { data } = await query;
  const rows = (data ?? []) as unknown as DonorRow[];
  return (
    <>
      <Title>Donor eligibility</Title>
      <p className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /><span><b>Record only.</b> Whether someone may donate is decided by an authorised blood service or clinician. Here you can only <b>record a decision they communicated</b>, naming the source. App administrators cannot medically clear a donor. Every entry is audited. {MEDICAL_NOTE}</span></p>
      <Search q={q} placeholder="e.g. Ayesha" />
      <Card className="relative overflow-x-auto" role="region" aria-label="Table" tabIndex={0}>
        {rows.length ? <table className="w-full min-w-[40rem] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">Donor</th><th className="pr-4">Group</th><th className="pr-4">Recorded status</th><th className="pr-4">Source</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((d) => (
            <tr key={d.user_id}><td className="py-2.5 pr-4 font-medium">{d.profile?.full_name}<span className="block text-xs font-normal text-muted">{d.profile?.city}</span></td><td className="pr-4">{d.blood_group}</td>
              <td className="pr-4"><Badge tone={d.eligibility_status === "deferred" ? "critical" : d.eligibility_status === "cleared" ? "fulfilled" : "neutral"}>{d.eligibility_status}</Badge></td>
              <td className="pr-4 text-xs text-muted">{d.eligibility_source ? `${d.eligibility_source}${d.eligibility_recorded_at ? ` · ${date(d.eligibility_recorded_at)}` : ""}` : "-"}</td>
              <td className="text-right"><ActionDialog action={recordEligibilityAction} fields={{ user: d.user_id }} trigger="Record decision…" title={`Record a blood-service decision for ${d.profile?.full_name}`} confirm="Record decision" noteLabel="Note"
                description="Only record a decision that an authorised blood service communicated. The source is required and audited.">
                <label className="grid gap-1.5 text-sm font-semibold text-navy">Decision recorded
                  <Select name="status" defaultValue={d.eligibility_status}><option value="unverified">Unverified (no decision recorded)</option><option value="cleared">Cleared by the blood service</option><option value="deferred">Deferred by the blood service</option></Select></label>
                <label className="grid gap-1.5 text-sm font-semibold text-navy">Source (blood service / reference)
                  <input name="source" required minLength={3} maxLength={120} placeholder="e.g. City Blood Bank, ref 1042" className="min-h-11 rounded-xl border-[1.5px] border-line px-3 font-normal" /></label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="attest" className="mt-0.5 size-5 accent-burgundy" /> This decision came from an authorised blood service. I am not making a medical judgement myself.</label>
              </ActionDialog></td></tr>))}</tbody></table> : <Empty>No donors yet.</Empty>}
      </Card>
    </>
  );
}

export async function DonorOffers() {
  const offers = (await rpc<MyOffer[]>("my_offers")).data ?? [];
  const invited = offers.filter((o) => o.status === "invited" && (o.request_status === "approved" || o.request_status === "matched"));
  const accepted = offers.filter((o) => o.status === "accepted");
  const history = offers.filter((o) => !invited.includes(o) && !accepted.includes(o));
  const Head = ({ o }: { o: MyOffer }) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold"><span className="mr-2 inline-grid h-8 min-w-11 place-items-center rounded-lg bg-burgundy px-2 font-display text-white">{o.blood_group}</span>{o.units} unit{o.units > 1 ? "s" : ""} · {o.hospital}, {o.city}</p>
      <span className="flex gap-1.5"><OfferBadge status={o.status} /><StatusBadge status={o.request_status} /></span>
    </div>);
  return (
    <>
      <Title>My offers</Title>
      <p className="mb-5 rounded-xl bg-teal-soft px-3.5 py-2.5 text-sm text-teal-900">{MEDICAL_NOTE}</p>
      <div className="grid gap-5">
        <section aria-labelledby="inv"><h2 id="inv" className="mb-3 text-xl font-bold">Invitations ({invited.length})</h2>
          {invited.length ? <ul className="grid gap-3">{invited.map((o) => (
            <li key={o.offer_id}><Card><Head o={o} />
              <div className="mt-3 flex flex-wrap items-start gap-4 border-t border-line pt-3">
                <InlineAction action={respondInvitationAction} fields={{ offer: o.offer_id, action: "accept" }} label="Accept invitation">
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="share" className="mt-0.5 size-5 accent-burgundy" /> Share my name, phone &amp; email with the requester</label></InlineAction>
                <InlineAction action={respondInvitationAction} fields={{ offer: o.offer_id, action: "decline" }} label="Decline" variant="outline" />
              </div></Card></li>))}</ul> : <Card><Empty>No pending invitations.</Empty></Card>}</section>
        <section aria-labelledby="act"><h2 id="act" className="mb-3 text-xl font-bold">Accepted offers ({accepted.length})</h2>
          {accepted.length ? <ul className="grid gap-3">{accepted.map((o) => (
            <li key={o.offer_id}><Card><Head o={o} />
              <div className="mt-3 grid gap-3 border-t border-line pt-3">
                <p className="text-sm">Contact sharing: <b>{o.consent_granted ? "ON" : "OFF"}</b>.{" "}
                  <span className="text-muted">{o.consent_granted ? "The requester can see your name, phone and email while this request is active." : "The requester cannot see your contact details."}</span></p>
                <p className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">Turning sharing off hides your details from the requester from now on. Information they already saw or copied cannot be recalled.</p>
                <div className="flex flex-wrap items-start gap-3">
                  {(o.request_status === "approved" || o.request_status === "matched") && (o.consent_granted
                    ? <InlineAction action={setConsentAction} fields={{ offer: o.offer_id, granted: "false" }} label="Stop sharing my contact details" variant="outline" />
                    : <InlineAction action={setConsentAction} fields={{ offer: o.offer_id, granted: "true" }} label="Share my contact details" variant="teal" />)}
                  {(o.request_status === "approved" || o.request_status === "matched") && <ActionDialog action={withdrawOfferAction} fields={{ offer: o.offer_id }} trigger="Withdraw offer" title="Withdraw your offer?" confirm="Withdraw offer"
                    description="Your offer is removed and contact sharing for this request is turned off. The requester is told a donor withdrew (not who)." />}
                </div></div></Card></li>))}</ul> : <Card><Empty>You haven&apos;t accepted any requests yet. <Link className="font-semibold text-teal underline" href="/dashboard/donor/opportunities">Browse opportunities</Link>.</Empty></Card>}</section>
        {history.length > 0 && <section aria-labelledby="hist"><h2 id="hist" className="mb-3 text-xl font-bold">History</h2>
          <ul className="grid gap-2">{history.map((o) => <li key={o.offer_id}><Card className="py-3"><Head o={o} /></Card></li>)}</ul></section>}
      </div>
    </>
  );
}
