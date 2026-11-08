import "server-only";
import { rpc } from "@/lib/rpc";
import { toCsv } from "@/lib/csv";
import { type AdminReport, type DonorReport, type Filters, type Rate, type RequesterReport, type Stats } from "@/lib/analytics-shared";

// Every call goes through the signed-in user's Supabase client; the SQL functions re-check the role and scope rows to auth.uid().
const args = (f: Filters) => ({ p_from: f.from, p_to: f.to, p_city: f.city || null, p_group: f.group || null });
export const adminReport = (f: Filters) => rpc<AdminReport>("analytics_admin", { ...args(f), p_scope: f.scope, p_min_group: 5 });
export const donorReport = (f: Filters) => rpc<DonorReport>("analytics_donor", args(f));
export const requesterReport = (f: Filters) => rpc<RequesterReport>("analytics_requester", args(f));

export type RequestRow = { total_rows: number; request_id: number; created_on: string; blood_group: string; city: string; urgency: string; units: number; status: string;
  hours_to_review: number | null; hours_to_first_accept: number | null; hours_approval_to_fulfilled: number | null; accepted_offers: number; is_demo: boolean };
export type OfferRow = { total_rows: number; offer_id: number; request_id: number; created_on: string; blood_group: string; city: string; urgency: string; request_status: string;
  origin: string; offer_status: string; accepted_on: string | null; withdrawn_on: string | null; completed: boolean };
export const requestRows = (kind: "admin" | "mine", f: Filters, limit: number, offset: number) =>
  rpc<RequestRow[]>("report_requests", { p_scope_kind: kind, ...args(f), p_data_scope: f.scope, p_limit: limit, p_offset: offset });
export const offerRows = (f: Filters, limit: number, offset: number) => rpc<OfferRow[]>("report_offers_mine", { ...args(f), p_limit: limit, p_offset: offset });

export const PAGE = 25, EXPORT_CAP = 10_000;
export const KINDS = { "admin.summary": "admin", "admin.trend": "admin", "admin.supply_demand": "admin", "admin.requests": "admin", "donor.offers": "donor", "requester.requests": "requester" } as const;
export type Kind = keyof typeof KINDS;

const rateRow = (name: string, r: Rate) => [name, r.rate, r.num, r.den];
const statRows = (name: string, s: Stats) => [[`${name}_median_hours`, s.median_h, s.n, ""], [`${name}_p90_hours`, s.p90_h, s.n, ""]];

/** Builds the CSV for an export. Only aggregate or de-identified columns exist here: no names, contacts, hospitals, patient labels or user ids. */
export async function buildCsv(kind: Kind, f: Filters): Promise<{ csv?: string; rows?: number; truncated?: boolean; error?: string }> {
  if (kind === "admin.summary" || kind === "admin.trend" || kind === "admin.supply_demand") {
    const { data: r, error } = await adminReport(f); if (error || !r) return { error: error ?? "No data" };
    if (kind === "admin.trend") return { csv: toCsv(["bucket_start_utc", "requests_created", "requests_approved", "requests_fulfilled"], r.trend.map((p) => [p.t, p.created, p.approved, p.fulfilled])), rows: r.trend.length };
    if (kind === "admin.supply_demand") return { csv: toCsv(["recipient_blood_group", "approved_or_matched_requests", "units_needed", "available_compatible_donors", "donors_per_unit"],
      r.supply_demand.map((x) => [x.group, x.demand_requests, x.demand_units, x.supply_donors, x.donors_per_unit])), rows: r.supply_demand.length };
    const rows: unknown[][] = [
      ["filter_from", f.from, "", ""], ["filter_to", f.to, "", ""], ["filter_city", f.city || "all", "", ""], ["filter_blood_group", f.group || "all", "", ""], ["filter_data_scope", f.scope, "", ""],
      ["min_group_size_for_city_breakdowns", r.meta.min_group, "", ""],
      ["donors_total", r.people.donors_total, "", ""], ["requesters_total", r.people.requesters_total, "", ""], ["donors_active", r.people.donors_active, "", ""], ["donors_available", r.people.donors_available, "", ""],
      ["requests_total", r.requests.total, "", ""],
      rateRow("approval_rate", r.rates.approval), rateRow("rejection_rate", r.rates.rejection), rateRow("matching_rate", r.rates.matching), rateRow("fulfillment_rate", r.rates.fulfillment), rateRow("cancellation_rate", r.rates.cancellation),
      ...statRows("review_time", r.timing.review), ...statRows("time_to_first_response", r.timing.first_response), ...statRows("approval_to_fulfilled", r.timing.approval_to_fulfilled),
      ["approved_without_response", r.timing.approved_without_response, "", ""],
      rateRow("notifications_read_rate", r.workflow.notifications_read), rateRow("email_delivery_rate", r.workflow.email_delivery), rateRow("invitation_response_rate", r.workflow.invitation_response),
      rateRow("invitation_acceptance_rate", r.workflow.invitation_acceptance), rateRow("contact_consent_rate", r.workflow.consent_granted),
      ...r.requests.by_status.map((x) => [`requests_status_${x.key}`, x.n, "", ""]), ...r.requests.by_urgency.map((x) => [`requests_urgency_${x.key}`, x.n, "", ""]),
      ...r.requests.by_city.map((x) => [`requests_city_${x.city}`, x.n, "", ""]),
    ];
    return { csv: toCsv(["metric", "value", "numerator_or_sample_size", "denominator"], rows), rows: rows.length };
  }
  if (kind === "donor.offers") {
    const { data, error } = await offerRows(f, EXPORT_CAP, 0); if (error || !data) return { error: error ?? "No data" };
    return { csv: toCsv(["offer_id", "request_id", "offered_on", "blood_group", "city", "urgency", "request_status", "origin", "offer_status", "accepted_on", "withdrawn_on", "completed"],
      data.map((o) => [o.offer_id, o.request_id, o.created_on, o.blood_group, o.city, o.urgency, o.request_status, o.origin, o.offer_status, o.accepted_on, o.withdrawn_on, o.completed])), rows: data.length, truncated: (data[0]?.total_rows ?? 0) > data.length };
  }
  const { data, error } = await requestRows(kind === "admin.requests" ? "admin" : "mine", f, EXPORT_CAP, 0); if (error || !data) return { error: error ?? "No data" };
  const header = ["request_id", "created_on", "blood_group", "city", "urgency", "units", "status", "hours_to_review", "hours_to_first_accept", "hours_approval_to_fulfilled", "accepted_offers", ...(kind === "admin.requests" ? ["fictional_demo_data"] : [])];
  return { csv: toCsv(header, data.map((r) => [r.request_id, r.created_on, r.blood_group, r.city, r.urgency, r.units, r.status, r.hours_to_review, r.hours_to_first_accept, r.hours_approval_to_fulfilled, r.accepted_offers, ...(kind === "admin.requests" ? [r.is_demo] : [])])),
    rows: data.length, truncated: (data[0]?.total_rows ?? 0) > data.length };
}
