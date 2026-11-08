import { BarsChart, TrendChart } from "@/components/analytics/charts";
import { ChartGrid, ExportLinks, FiltersForm, Grid, Notice, Pager, RateStat, Section, Stat, TimeStat } from "@/components/analytics/parts";
import { Card } from "@/components/ui/card";
import { OfferBadge, REQUEST_LABEL, StatusBadge } from "@/components/status-badge";
import { Title } from "@/components/dashboard/real/views";
import { adminReport, donorReport, offerRows, PAGE, requesterReport, requestRows } from "@/lib/analytics";
import { COLORS, hours, parseFilters, type Filters, type KV, type Trend } from "@/lib/analytics-shared";
import type { RequestStatus, OfferStatus } from "@/lib/types";

type SP = Record<string, string | string[] | undefined>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const statusName = (k: string) => REQUEST_LABEL[k as RequestStatus] ?? cap(k);
const kv = (a: KV[], name: (k: string) => string = cap) => a.map((x) => ({ name: name(x.key), n: x.n }));
const pageOf = (sp: SP) => Math.min(10_000, Math.max(1, Math.floor(Number(Array.isArray(sp.page) ? sp.page[0] : sp.page)) || 1));
const label = (t: string, bucket: string) => (bucket === "month" ? t.slice(0, 7) : bucket === "week" ? `wk ${t.slice(5)}` : t.slice(5));
const trend = (t: Trend, bucket: string) => t.map((p) => ({ ...p, name: label(p.t, bucket) })) as Record<string, string | number>[];
const Th = ({ children, r }: { children: React.ReactNode; r?: boolean }) => <th scope="col" className={`py-2 pr-4 ${r ? "text-right" : ""}`}>{children}</th>;
const Table = ({ caption, head, children }: { caption: string; head: React.ReactNode; children: React.ReactNode }) => (
  <Card className="overflow-x-auto" data-testid="history"><table className="w-full min-w-[40rem] text-left text-sm"><caption className="sr-only">{caption}</caption><thead className="text-xs uppercase tracking-wide text-muted"><tr>{head}</tr></thead><tbody className="divide-y divide-line">{children}</tbody></table></Card>
);

function Frame({ title, f, admin, action, error, bad, children }: { title: string; f: Filters; admin?: boolean; action: string; error?: string; bad?: string; children: React.ReactNode }) {
  return (<><Title>{title}</Title><FiltersForm f={f} admin={admin} action={action} />
    {bad && <Notice tone="warn" testId="filter-error">{bad} Showing the default range instead.</Notice>}
    {error ? <Notice tone="error" testId="report-error">We couldn&apos;t load this report: {error} Please adjust the filters or try again.</Notice> : children}</>);
}

export async function AdminAnalytics({ sp }: { sp: SP }) {
  const { filters: f, error: bad } = parseFilters(sp, true), page = pageOf(sp), action = "/dashboard/admin/reports";
  const [{ data: r, error }, { data: rows }] = await Promise.all([adminReport(f), requestRows("admin", f, PAGE, (page - 1) * PAGE)]);
  if (error || !r) return <Frame title="Analytics & reports" f={f} admin action={action} error={error} bad={bad}>{null}</Frame>;
  const b = r.meta.bucket, empty = r.requests.total === 0;
  const sd = r.supply_demand.map((x) => ({ name: x.group, donors: x.supply_donors, units: x.demand_units }));
  return (
    <Frame title="Analytics & reports" f={f} admin action={action} bad={bad}>
      {r.meta.demo_accounts > 0 && <Notice testId="demo-banner">{r.meta.scope === "real" ? "Showing real accounts only." : `Includes fictional demo data: ${r.meta.demo_accounts} of ${r.meta.all_accounts} accounts are fictional (reserved .example addresses).`}{" "}Use “Data” above to separate real from demo figures.</Notice>}
      {empty && <Notice testId="empty-state">No requests were created in this selection. Widen the date range or clear the city and blood-group filters.</Notice>}
      <ExportLinks f={f} items={[["admin.summary", "Summary"], ["admin.trend", "Trend"], ["admin.supply_demand", "Supply vs demand"], ["admin.requests", "Requests (rows)"]]} />

      <Section title="People" id="people"><Grid>
        <Stat testId="kpi-donors" label="Registered donors" value={r.people.donors_total} hint={`${r.people.donors_new_in_range} new in range`} />
        <Stat testId="kpi-requesters" label="Registered requesters" value={r.people.requesters_total} hint={`${r.people.requesters_new_in_range} new in range`} />
        <Stat testId="kpi-active" label="Active donors" value={r.people.donors_active} hint="Not suspended" />
        <Stat testId="kpi-available" label="Available donors" value={r.people.donors_available} hint={`Available and not deferred · ${r.people.donors_engaged_90d} responded in 90 days`} />
      </Grid></Section>

      <Section title="Outcomes" id="outcomes"><Grid>
        <RateStat testId="rate-approval" label="Approval rate" r={r.rates.approval} /><RateStat testId="rate-rejection" label="Rejection rate" r={r.rates.rejection} />
        <RateStat testId="rate-matching" label="Matching rate" r={r.rates.matching} /><RateStat testId="rate-fulfillment" label="Fulfillment rate" r={r.rates.fulfillment} />
      </Grid>
      <Grid cols={3}>
        <TimeStat testId="time-review" label="Time to review" s={r.timing.review} /><TimeStat testId="time-response" label="Time to first donor response" s={r.timing.first_response} />
        <TimeStat testId="time-fulfilled" label="Approval to fulfilled" s={r.timing.approval_to_fulfilled} />
      </Grid>
      <p className="-mt-3 mb-4 text-xs text-muted">Rates show “—” when nothing can be divided. Durations only include requests that reached both steps; {r.timing.approved_without_response} approved request(s) have no accepted donor yet and are excluded from the response time.</p></Section>

      <Section title="Requests" id="requests-h"><ChartGrid>
        <TrendChart title="Requests over time" note={`Per ${b}; each series counted on its own event date`} nameLabel="Period" data={trend(r.trend, b)}
          series={[{ key: "created", label: "Created", color: COLORS.burgundy }, { key: "approved", label: "Approved", color: COLORS.teal }, { key: "fulfilled", label: "Fulfilled", color: COLORS.sand }]} />
        <BarsChart title="Requests by status" nameLabel="Status" data={kv(r.requests.by_status, statusName)} series={[{ key: "n", label: "Requests", color: COLORS.burgundy }]} />
        <BarsChart title="Requests by urgency" nameLabel="Urgency" data={kv(r.requests.by_urgency)} series={[{ key: "n", label: "Requests", color: COLORS.coral }]} />
        <BarsChart title="Requests by city" note={`Cities with fewer than ${r.meta.min_group} requests are grouped as “Other”`} nameLabel="City" horizontal data={r.requests.by_city.map((x) => ({ name: x.city, n: x.n }))} series={[{ key: "n", label: "Requests", color: COLORS.navy }]} />
        <BarsChart title="Requests and units by blood group" nameLabel="Blood group" data={r.requests.by_group.map((x) => ({ name: x.key, n: x.n, units: x.units }))} series={[{ key: "n", label: "Requests", color: COLORS.burgundy }, { key: "units", label: "Units", color: COLORS.teal }]} />
      </ChartGrid></Section>

      <Section title="Donors and supply" id="supply">
        <ChartGrid>
          <BarsChart title="Donors by blood group" nameLabel="Blood group" data={r.people.donors_by_group.map((x) => ({ name: x.group, total: x.total, available: x.available }))} series={[{ key: "total", label: "Registered", color: COLORS.navy }, { key: "available", label: "Available", color: COLORS.teal }]} />
          <BarsChart title="Supply vs demand (preliminary)" note="Compatible available donors vs units on approved or matched requests. Donors are people, not units in stock." nameLabel="Recipient group" data={sd}
            series={[{ key: "donors", label: "Compatible available donors", color: COLORS.teal }, { key: "units", label: "Units needed", color: COLORS.burgundy }]} />
          <BarsChart title="Donors by city" note={`Cities with fewer than ${r.meta.min_group} donors are grouped as “Other”`} nameLabel="City" horizontal data={r.people.donors_by_city.map((x) => ({ name: x.city, n: x.n }))} series={[{ key: "n", label: "Donors", color: COLORS.navy }]} />
        </ChartGrid>
        <Card className="overflow-x-auto" data-testid="supply-table"><table className="w-full min-w-[32rem] text-left text-sm"><caption className="sr-only">Preliminary supply versus demand by recipient blood group</caption>
          <thead className="text-xs uppercase tracking-wide text-muted"><tr><Th>Recipient group</Th><Th r>Open requests</Th><Th r>Units needed</Th><Th r>Compatible donors</Th><Th r>Donors per unit</Th></tr></thead>
          <tbody className="divide-y divide-line">{r.supply_demand.map((x) => <tr key={x.group}><th scope="row" className="py-2 pr-4 font-medium">{x.group}</th><td className="pr-4 text-right tabular-nums">{x.demand_requests}</td><td className="pr-4 text-right tabular-nums">{x.demand_units}</td><td className="pr-4 text-right tabular-nums">{x.supply_donors}</td><td className="pr-4 text-right tabular-nums">{x.donors_per_unit ?? "—"}</td></tr>)}</tbody></table></Card>
      </Section>

      <Section title="Notifications and consent" id="workflow"><Grid>
        <RateStat testId="rate-read" label="Notifications read" r={r.workflow.notifications_read} /><RateStat testId="rate-email" label="Email delivery" r={r.workflow.email_delivery} />
        <RateStat testId="rate-invite" label="Invitation response" r={r.workflow.invitation_response} /><RateStat testId="rate-consent" label="Contact consent granted" r={r.workflow.consent_granted} />
      </Grid>
      <ChartGrid>
        <BarsChart title="Notifications by category" note={`${r.workflow.notifications_total} sent in range`} nameLabel="Category" data={kv(r.workflow.notifications_by_category)} series={[{ key: "n", label: "Notifications", color: COLORS.coral }]} />
        <BarsChart title="Email outbox by status" nameLabel="Status" data={kv(r.workflow.emails_by_status)} series={[{ key: "n", label: "Emails", color: COLORS.navy }]} />
      </ChartGrid>
      <p className="-mt-2 text-xs text-muted">{r.workflow.invitations_sent} invitation(s) sent · {r.workflow.offers_accepted} offer(s) accepted · {r.workflow.offers_withdrawn} withdrawn · {r.workflow.consent_revoked} consent(s) revoked · invitation acceptance {r.workflow.invitation_acceptance.rate === null ? "—" : `${r.workflow.invitation_acceptance.num} of ${r.workflow.invitation_acceptance.den} replies`}.</p></Section>

      <Section title="Request rows (de-identified)" id="rows">
        {rows?.length ? (<><Table caption="Requests in this selection, without names, hospitals or patient labels" head={<><Th>ID</Th><Th>Created</Th><Th>Group</Th><Th>City</Th><Th>Urgency</Th><Th r>Units</Th><Th>Status</Th><Th r>To review</Th><Th r>To first accept</Th></>}>
          {rows.map((x) => <tr key={x.request_id}><th scope="row" className="py-2 pr-4 font-medium">#{x.request_id}{x.is_demo && <span className="ml-1.5 rounded bg-offwhite px-1.5 text-xs text-muted">demo</span>}</th><td className="pr-4">{x.created_on}</td><td className="pr-4">{x.blood_group}</td><td className="pr-4">{x.city}</td><td className="pr-4">{cap(x.urgency)}</td><td className="pr-4 text-right">{x.units}</td><td className="pr-4"><StatusBadge status={x.status as RequestStatus} /></td><td className="pr-4 text-right">{hours(x.hours_to_review)}</td><td className="pr-4 text-right">{hours(x.hours_to_first_accept)}</td></tr>)}</Table>
          <Pager f={f} action={action} page={page} total={rows[0].total_rows} size={PAGE} /></>) : <Notice testId="rows-empty">No requests to list for this selection.</Notice>}
      </Section>
      <p className="text-xs text-muted">Generated {new Date(r.meta.generated_at).toUTCString()}. Definitions: see docs/STAGE6-ANALYTICS.md. Preliminary supply figures are not blood inventory and not a medical or clinical measure.</p>
    </Frame>
  );
}

export async function DonorAnalytics({ sp }: { sp: SP }) {
  const { filters: f, error: bad } = parseFilters(sp, false), page = pageOf(sp), action = "/dashboard/donor/analytics";
  const [{ data: r, error }, { data: rows }] = await Promise.all([donorReport(f), offerRows(f, PAGE, (page - 1) * PAGE)]);
  if (error || !r) return <Frame title="My activity" f={f} action={action} error={error} bad={bad}>{null}</Frame>;
  const b = r.meta.bucket;
  return (
    <Frame title="My activity" f={f} action={action} bad={bad}>
      {r.totals.offers === 0 && <Notice testId="empty-state">You have no offers or invitations in this selection yet. Open “Opportunities” to see requests you can help with.</Notice>}
      <ExportLinks f={f} items={[["donor.offers", "My offers (rows)"]]} />
      <Grid>
        <Stat testId="kpi-offers" label="Offers and invitations" value={r.totals.offers} hint={`${r.totals.invited} invited · ${r.totals.volunteered} volunteered`} />
        <Stat testId="kpi-accepted" label="Accepted" value={r.totals.accepted_ever} hint={`${r.totals.accepted_now} still active`} />
        <Stat testId="kpi-withdrawn" label="Withdrawn" value={r.totals.withdrawn} hint={`${r.totals.declined} declined · ${r.totals.awaiting_reply} awaiting your reply`} />
        <Stat testId="kpi-completed" label="Completed" value={r.totals.completed} hint="Accepted offers on fulfilled requests" />
      </Grid>
      <Grid>
        <RateStat testId="rate-reply" label="Invitations answered" r={r.rates.invitation_response} /><RateStat testId="rate-accept" label="Acceptance of answered" r={r.rates.acceptance} />
        <RateStat testId="rate-complete" label="Completion of accepted" r={r.rates.completion} /><TimeStat testId="time-reply" label="Time to answer an invitation" s={r.timing.invitation_reply} />
      </Grid>
      <ChartGrid>
        <TrendChart title="My activity over time" note={`Per ${b}`} nameLabel="Period" data={trend(r.trend, b)} series={[{ key: "invited", label: "Invited", color: COLORS.navy }, { key: "accepted", label: "Accepted", color: COLORS.teal }, { key: "declined", label: "Declined", color: COLORS.sand }, { key: "withdrawn", label: "Withdrawn", color: COLORS.coral }]} />
        <BarsChart title="My offers by current status" nameLabel="Status" data={kv(r.by_status)} series={[{ key: "n", label: "Offers", color: COLORS.burgundy }]} />
      </ChartGrid>
      <Section title="My offer history" id="rows">
        {rows?.length ? (<><Table caption="Your offers and invitations" head={<><Th>Request</Th><Th>Offered</Th><Th>Group</Th><Th>City</Th><Th>Origin</Th><Th>My offer</Th><Th>Request status</Th></>}>
          {rows.map((o) => <tr key={o.offer_id}><th scope="row" className="py-2 pr-4 font-medium">#{o.request_id}</th><td className="pr-4">{o.created_on}</td><td className="pr-4">{o.blood_group}</td><td className="pr-4">{o.city}</td><td className="pr-4">{cap(o.origin)}</td><td className="pr-4"><OfferBadge status={o.offer_status as OfferStatus} /></td><td className="pr-4"><StatusBadge status={o.request_status as RequestStatus} /></td></tr>)}</Table>
          <Pager f={f} action={action} page={page} total={rows[0].total_rows} size={PAGE} /></>) : <Notice testId="rows-empty">No offers to list for this selection.</Notice>}
      </Section>
      <p className="text-xs text-muted">Only your own activity is shown. “Completed” means an accepted offer on a request that was marked fulfilled; DonorConnect does not record the donation itself.</p>
    </Frame>
  );
}

export async function RequesterAnalytics({ sp }: { sp: SP }) {
  const { filters: f, error: bad } = parseFilters(sp, false), page = pageOf(sp), action = "/dashboard/requester/analytics";
  const [{ data: r, error }, { data: rows }] = await Promise.all([requesterReport(f), requestRows("mine", f, PAGE, (page - 1) * PAGE)]);
  if (error || !r) return <Frame title="My request insights" f={f} action={action} error={error} bad={bad}>{null}</Frame>;
  const b = r.meta.bucket;
  return (
    <Frame title="My request insights" f={f} action={action} bad={bad}>
      {r.totals.requests === 0 && <Notice testId="empty-state">You have no requests in this selection. Widen the date range, or create a request from “New request”.</Notice>}
      <ExportLinks f={f} items={[["requester.requests", "My requests (rows)"]]} />
      <Grid>
        <Stat testId="kpi-requests" label="Requests" value={r.totals.requests} hint={`${r.totals.units} unit(s) in total`} /><Stat testId="kpi-active" label="Active" value={r.totals.active} hint="Pending, approved or matched" />
        <Stat testId="kpi-fulfilled" label="Fulfilled" value={r.totals.fulfilled} /><Stat testId="kpi-donor" label="With an accepted donor" value={r.totals.with_accepted_donor} hint="Donors are never identified here" />
      </Grid>
      <Grid cols={3}>
        <RateStat testId="rate-approval" label="Approved of reviewed" r={r.rates.approval} /><RateStat testId="rate-response" label="Approved requests with a donor" r={r.rates.response} /><RateStat testId="rate-fulfillment" label="Approved requests fulfilled" r={r.rates.fulfillment} />
      </Grid>
      <Grid cols={3}>
        <TimeStat testId="time-review" label="Time to review" s={r.timing.review} /><TimeStat testId="time-response" label="Time to first donor response" s={r.timing.first_response} /><TimeStat testId="time-fulfilled" label="Approval to fulfilled" s={r.timing.approval_to_fulfilled} />
      </Grid>
      <ChartGrid>
        <TrendChart title="My requests over time" note={`Per ${b}`} nameLabel="Period" data={trend(r.trend, b)} series={[{ key: "created", label: "Created", color: COLORS.burgundy }, { key: "fulfilled", label: "Fulfilled", color: COLORS.teal }]} />
        <BarsChart title="Requests by status" nameLabel="Status" data={kv(r.by_status, statusName)} series={[{ key: "n", label: "Requests", color: COLORS.burgundy }]} />
        <BarsChart title="Requests by urgency" nameLabel="Urgency" data={kv(r.by_urgency)} series={[{ key: "n", label: "Requests", color: COLORS.coral }]} />
      </ChartGrid>
      <Section title="My request history" id="rows">
        {rows?.length ? (<><Table caption="Your requests with response and fulfillment timelines" head={<><Th>ID</Th><Th>Created</Th><Th>Group</Th><Th>Urgency</Th><Th>Status</Th><Th r>To review</Th><Th r>To first donor</Th><Th r>To fulfilled</Th></>}>
          {rows.map((x) => <tr key={x.request_id}><th scope="row" className="py-2 pr-4 font-medium">#{x.request_id}</th><td className="pr-4">{x.created_on}</td><td className="pr-4">{x.blood_group}</td><td className="pr-4">{cap(x.urgency)}</td><td className="pr-4"><StatusBadge status={x.status as RequestStatus} /></td><td className="pr-4 text-right">{hours(x.hours_to_review)}</td><td className="pr-4 text-right">{hours(x.hours_to_first_accept)}</td><td className="pr-4 text-right">{hours(x.hours_approval_to_fulfilled)}</td></tr>)}</Table>
          <Pager f={f} action={action} page={page} total={rows[0].total_rows} size={PAGE} /></>) : <Notice testId="rows-empty">No requests to list for this selection.</Notice>}
      </Section>
      <p className="text-xs text-muted">Only your own requests are shown. Times are measured from approval (first donor, fulfilled) or creation (review); missing steps are left out of averages.</p>
    </Frame>
  );
}
