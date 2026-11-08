import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildCsv, KINDS, type Kind } from "@/lib/analytics";
import { parseFilters } from "@/lib/analytics-shared";
import { rpc } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const H = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: H });

/** CSV export. Order matters: authenticate -> authorize by role -> validate input -> compute (SQL re-checks role) -> audit + rate limit -> only then send data. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await getSession();
  if (!s) return fail(401, "Please sign in again.");
  if (s.profile.suspended) return fail(403, "Not allowed.");
  const { kind } = await params;
  if (!Object.hasOwn(KINDS, kind)) return fail(404, "Unknown report.");
  if (KINDS[kind as Kind] !== s.profile.role) return fail(403, "That report is not available for your role.");

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const { filters, error: bad } = parseFilters(sp, s.profile.role === "admin");
  if (bad || (sp.from === undefined) !== (sp.to === undefined)) return fail(400, bad ?? "Provide both a start and end date.");

  const out = await buildCsv(kind as Kind, filters);
  if (out.error || !out.csv) return fail(out.error?.includes("not allowed") ? 403 : 400, out.error ?? "Report failed.");
  const log = await rpc("log_report_event", { p_kind: kind, p_params: { from: filters.from, to: filters.to, city: filters.city, group: filters.group, scope: filters.scope, rows: String(out.rows ?? 0) } });
  if (log.error) return fail(429, log.error); // rate limited (or audit failed): nothing is sent

  return new NextResponse(out.csv, { headers: { ...H, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="donorconnect-${kind.replace(".", "-")}-${filters.from}_${filters.to}.csv"`, ...(out.truncated ? { "X-Report-Truncated": "true" } : {}) } });
}
