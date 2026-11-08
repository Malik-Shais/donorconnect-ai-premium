import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { filterQuery, hours, pct, daysAgo, today, type Filters, type Rate, type Stats } from "@/lib/analytics-shared";
import { GROUPS } from "@/lib/compat";

const field = "block text-xs font-semibold uppercase tracking-wide text-muted";

/** Plain GET form: works without JavaScript, keeps the URL shareable and the filters server-validated. */
export function FiltersForm({ f, admin, action }: { f: Filters; admin?: boolean; action: string }) {
  const presets: [string, number][] = [["7 days", 6], ["30 days", 29], ["90 days", 89], ["12 months", 364]];
  const preset = (n: number) => `${action}?${filterQuery({ ...f, from: daysAgo(n), to: today() })}`;
  return (
    <form method="get" action={action} aria-label="Report filters" className="mb-5 rounded-2xl border border-line bg-white p-4 shadow-card" data-testid="filters">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className={field}>From<Input type="date" name="from" defaultValue={f.from} max={today()} required className="mt-1 font-normal normal-case tracking-normal" /></label>
        <label className={field}>To<Input type="date" name="to" defaultValue={f.to} max={today()} required className="mt-1 font-normal normal-case tracking-normal" /></label>
        <label className={field}>City<Input name="city" defaultValue={f.city} maxLength={60} placeholder="All cities" className="mt-1 font-normal normal-case tracking-normal" /></label>
        <label className={field}>Blood group
          <select name="group" aria-label="Blood group" defaultValue={f.group} className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-line bg-white px-3 font-normal normal-case tracking-normal text-ink focus:border-teal">
            <option value="">All groups</option>{GROUPS.map((g) => <option key={g}>{g}</option>)}
          </select></label>
        {admin ? (
          <label className={field}>Data
            <select name="scope" aria-label="Data scope" defaultValue={f.scope} className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-line bg-white px-3 font-normal normal-case tracking-normal text-ink focus:border-teal">
              <option value="all">All data</option><option value="real">Real accounts only</option><option value="demo">Fictional demo only</option>
            </select></label>
        ) : <span className="hidden lg:block" />}
        <div className="flex items-end gap-2"><button type="submit" className="min-h-11 flex-1 rounded-full bg-gradient-to-br from-burgundy to-coral-dark px-5 font-semibold text-white">Apply</button>
          <Link href={action} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-teal hover:underline">Reset</Link></div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted"><span>Quick range:</span>
        {presets.map(([l, n]) => <Link key={l} href={preset(n)} className="inline-flex min-h-8 items-center font-semibold text-teal hover:underline">{l}</Link>)}
        <span className="ml-auto text-xs">Dates are UTC days; both ends inclusive.</span></p>
    </form>
  );
}

export function Stat({ label, value, hint, testId }: { label: string; value: React.ReactNode; hint?: React.ReactNode; testId?: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="font-display text-3xl font-bold text-burgundy">{value}</div>
      <div className="text-sm font-medium text-navy">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}
export const RateStat = ({ label, r, testId }: { label: string; r: Rate; testId?: string }) =>
  <Stat label={label} value={pct(r.rate)} testId={testId} hint={r.den === 0 ? "No data: nothing to divide by" : `${r.num} of ${r.den}`} />;
export const TimeStat = ({ label, s, testId }: { label: string; s: Stats; testId?: string }) =>
  <Stat label={label} value={hours(s.median_h)} testId={testId} hint={s.n === 0 ? "No data yet" : `median · 90th pct ${hours(s.p90_h)} · n=${s.n}`} />;
export const Grid = ({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) =>
  <div className={`mb-6 grid grid-cols-2 gap-3.5 ${cols === 4 ? "lg:grid-cols-4" : cols === 3 ? "lg:grid-cols-3" : ""}`}>{children}</div>;
export const Section = ({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) =>
  <section aria-labelledby={id} className="mb-8"><h2 id={id} className="mb-3 text-xl font-semibold">{title}</h2>{children}</section>;
export const ChartGrid = ({ children }: { children: React.ReactNode }) => <div className="mb-6 grid gap-4 lg:grid-cols-2">{children}</div>;

export const Notice = ({ tone = "info", children, testId }: { tone?: "info" | "warn" | "error"; children: React.ReactNode; testId?: string }) => (
  <p role={tone === "error" ? "alert" : "status"} data-testid={testId} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${tone === "error" ? "border-red-200 bg-red-50 text-red-800" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-teal/30 bg-teal-soft text-navy"}`}>{children}</p>
);

export function ExportLinks({ items, f }: { items: [string, string][]; f: Filters }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="exports"><span className="text-sm font-semibold text-navy">Download CSV:</span>
      {items.map(([kind, label]) => <a key={kind} href={`/api/reports/${kind}?${filterQuery(f)}`} download className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-line bg-white px-4 text-sm font-semibold text-navy hover:bg-offwhite">{label}</a>)}
      <span className="text-xs text-muted">Aggregates and de-identified rows only; small groups are suppressed; every export is logged.</span></div>
  );
}

export function Pager({ f, action, page, total, size }: { f: Filters; action: string; page: number; total: number; size: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const href = (p: number) => `${action}?${filterQuery(f, { page: p })}`;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm">
      <span className="text-muted" data-testid="pager-info">Page {page} of {pages} · {total} row{total === 1 ? "" : "s"}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} rel="prev" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-semibold">Previous</Link> : <span className="inline-flex min-h-11 items-center px-4 text-muted">Previous</span>}
        {page < pages ? <Link href={href(page + 1)} rel="next" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-semibold">Next</Link> : <span className="inline-flex min-h-11 items-center px-4 text-muted">Next</span>}
      </span>
    </nav>
  );
}
export const Pill = ({ children }: { children: React.ReactNode }) => <Badge tone="neutral">{children}</Badge>;
