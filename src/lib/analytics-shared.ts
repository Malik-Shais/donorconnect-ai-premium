import { z } from "zod";
import { GROUPS } from "@/lib/compat";

// Safe to import from client and server code (no secrets, no server-only modules). Dates are UTC calendar days.
// Palette lives here (not in the "use client" chart module): server components cannot read values exported from client modules.
export const COLORS = { burgundy: "#7a1630", coral: "#e8503f", teal: "#0e8f9b", navy: "#1f3552", sand: "#b8860b" };
export type Scope = "all" | "real" | "demo";
export type Filters = { from: string; to: string; city: string; group: string; scope: Scope };
export const MAX_DAYS = 1830;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
export const defaultFilters = (): Filters => ({ from: daysAgo(89), to: today(), city: "", group: "", scope: "all" });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { const t = Date.parse(`${s}T00:00:00Z`); return !Number.isNaN(t) && iso(new Date(t)) === s; }, "Enter a valid date");
const Schema = z.object({
  from: day, to: day,
  city: z.string().trim().max(60).regex(/^[\p{L}\p{N} .'\-]*$/u, "City contains unsupported characters"),
  group: z.enum(["", ...GROUPS]),
  scope: z.enum(["all", "real", "demo"]),
}).refine((f) => f.from <= f.to, { message: "The start date must not be after the end date" })
  .refine((f) => (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 <= MAX_DAYS, { message: "The date range can be at most 5 years" });

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Parses untrusted query parameters. Invalid input never reaches SQL: the caller gets defaults plus a user-safe message. `scope` is honoured for administrators only. */
export function parseFilters(sp: Record<string, string | string[] | undefined>, isAdmin: boolean): { filters: Filters; error?: string } {
  const d = defaultFilters();
  const raw = { from: one(sp.from) || d.from, to: one(sp.to) || d.to, city: one(sp.city), group: one(sp.group), scope: isAdmin ? one(sp.scope) || "all" : "all" };
  const r = Schema.safeParse(raw);
  return r.success ? { filters: r.data as Filters } : { filters: d, error: r.error.issues[0]?.message ?? "Invalid filters" };
}
export const filterQuery = (f: Filters, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams({ from: f.from, to: f.to });
  if (f.city) p.set("city", f.city);
  if (f.group) p.set("group", f.group);
  if (f.scope !== "all") p.set("scope", f.scope);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
};

export const pct = (rate: number | null | undefined) => (rate === null || rate === undefined ? "—" : `${Math.round(rate * 1000) / 10}%`);
export const hours = (h: number | null | undefined) => (h === null || h === undefined ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} d`);

export type Rate = { num: number; den: number; rate: number | null };
export type Stats = { n: number; median_h: number | null; p90_h: number | null };
export type KV = { key: string; n: number };
export type Trend = { t: string; [series: string]: number | string }[];
export type AdminReport = {
  meta: { from: string; to: string; bucket: "day" | "week" | "month"; city: string | null; blood_group: string | null; scope: Scope; min_group: number; demo_accounts: number; all_accounts: number; generated_at: string };
  people: { donors_total: number; requesters_total: number; donors_active: number; donors_available: number; donors_new_in_range: number; requesters_new_in_range: number; donors_engaged_90d: number;
            donors_by_group: { group: string; total: number; available: number }[]; donors_by_city: { city: string; n: number }[] };
  requests: { total: number; by_status: KV[]; by_urgency: KV[]; by_group: (KV & { units: number })[]; by_city: { city: string; n: number }[] };
  rates: Record<"approval" | "rejection" | "matching" | "fulfillment" | "cancellation", Rate>;
  timing: { review: Stats; first_response: Stats; approval_to_fulfilled: Stats; approved_without_response: number };
  trend: Trend;
  supply_demand: { group: string; demand_requests: number; demand_units: number; supply_donors: number; donors_per_unit: number | null }[];
  workflow: { notifications_total: number; notifications_read: Rate; notifications_by_category: KV[]; emails_by_status: KV[]; email_delivery: Rate; invitations_sent: number; invitation_response: Rate;
              invitation_acceptance: Rate; offers_accepted: number; offers_withdrawn: number; consent_granted: Rate; consent_revoked: number };
};
export type DonorReport = {
  meta: AdminReport["meta"];
  totals: { offers: number; invited: number; volunteered: number; accepted_ever: number; accepted_now: number; withdrawn: number; declined: number; awaiting_reply: number; completed: number; contact_shared_now: number };
  by_status: KV[]; rates: Record<"invitation_response" | "acceptance" | "completion" | "withdrawal", Rate>; timing: { invitation_reply: Stats }; trend: Trend;
};
export type RequesterReport = {
  meta: AdminReport["meta"];
  totals: { requests: number; units: number; with_accepted_donor: number; fulfilled: number; active: number };
  by_status: KV[]; by_urgency: KV[]; rates: Record<"approval" | "response" | "fulfillment", Rate>; timing: { review: Stats; first_response: Stats; approval_to_fulfilled: Stats }; trend: Trend;
};
