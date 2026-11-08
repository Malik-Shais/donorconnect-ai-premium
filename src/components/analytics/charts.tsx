"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// Every chart ships with (1) a text summary as its accessible name and (2) the same numbers as a real table, so nothing depends on colour or pointer.
export type Series = { key: string; label: string; color: string };

function DataTable({ caption, data, nameLabel, series }: { caption: string; data: Record<string, string | number>[]; nameLabel: string; series: Series[] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-teal">View as data table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line" role="region" aria-label={`${caption} data`} tabIndex={0}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-offwhite text-xs uppercase tracking-wide text-muted"><tr><th scope="col" className="px-3 py-2">{nameLabel}</th>{series.map((s) => <th key={s.key} scope="col" className="px-3 py-2 text-right">{s.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{data.map((r) => <tr key={String(r.name)}><th scope="row" className="px-3 py-1.5 font-medium">{r.name}</th>{series.map((s) => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{r[s.key] ?? 0}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

type Props = { title: string; note?: string; data: Record<string, string | number>[]; series: Series[]; nameLabel?: string; height?: number; horizontal?: boolean };
const total = (d: Props["data"], s: Series[]) => d.reduce((a, r) => a + s.reduce((b, x) => b + Number(r[x.key] ?? 0), 0), 0);
const summary = (p: Props) => `${p.title}. ${p.data.length} categories, ${p.series.map((s) => `${s.label} total ${p.data.reduce((a, r) => a + Number(r[s.key] ?? 0), 0)}`).join(", ")}. A data table follows.`;

// The plotting code (recharts) is a separate chunk, fetched only when the chart is near the viewport. A fixed-height box prevents layout shift.
const TrendPlot = dynamic(() => import("@/components/analytics/plot").then((m) => m.TrendPlot), { ssr: false });
const BarsPlot = dynamic(() => import("@/components/analytics/plot").then((m) => m.BarsPlot), { ssr: false });

function Lazy({ height, children }: { height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "400px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ minHeight: height }}>{seen ? children : <div className="h-full w-full animate-pulse rounded-xl bg-offwhite" style={{ height }} aria-hidden="true" />}</div>;
}

function Frame({ p, height, children }: { p: Props; height: number; children: React.ReactNode }) {
  const empty = total(p.data, p.series) === 0;
  return (
    <figure className="rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5" data-testid="chart" data-empty={empty}>
      <figcaption className="mb-2"><span className="block text-base font-semibold">{p.title}</span>{p.note && <span className="block text-xs text-muted">{p.note}</span>}</figcaption>
      {empty ? <p className="rounded-xl bg-offwhite px-4 py-10 text-center text-sm text-muted">No data for this selection.</p>
        : <div role="img" aria-label={summary(p)}><Lazy height={height}>{children}</Lazy></div>}
      {!empty && <DataTable caption={p.title} data={p.data} nameLabel={p.nameLabel ?? "Category"} series={p.series} />}
    </figure>
  );
}

export function TrendChart(p: Props) {
  const h = p.height ?? 260;
  return <Frame p={p} height={h}><TrendPlot data={p.data} series={p.series} height={h} /></Frame>;
}

export function BarsChart(p: Props) {
  const h = p.horizontal ? Math.max(180, p.data.length * 34 + 40) : p.height ?? 240;
  return <Frame p={p} height={h}><BarsPlot data={p.data} series={p.series} height={h} horizontal={p.horizontal} /></Frame>;
}
