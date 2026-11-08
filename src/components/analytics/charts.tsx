"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Every chart ships with (1) a text summary as its accessible name and (2) the same numbers as a real table, so nothing depends on colour or pointer.
export type Series = { key: string; label: string; color: string };
const axis = { fontSize: 12, fill: "#4d5d70" };

function DataTable({ caption, data, nameLabel, series }: { caption: string; data: Record<string, string | number>[]; nameLabel: string; series: Series[] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-teal">View as data table</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line">
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

function Frame({ p, children }: { p: Props; children: React.ReactNode }) {
  const empty = total(p.data, p.series) === 0;
  return (
    <figure className="rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5" data-testid="chart" data-empty={empty}>
      <figcaption className="mb-2"><span className="block text-base font-semibold">{p.title}</span>{p.note && <span className="block text-xs text-muted">{p.note}</span>}</figcaption>
      {empty ? <p className="rounded-xl bg-offwhite px-4 py-10 text-center text-sm text-muted">No data for this selection.</p>
        : <div role="img" aria-label={summary(p)}>{children}</div>}
      {!empty && <DataTable caption={p.title} data={p.data} nameLabel={p.nameLabel ?? "Category"} series={p.series} />}
    </figure>
  );
}

export function TrendChart(p: Props) {
  return (
    <Frame p={p}>
      <ResponsiveContainer width="100%" height={p.height ?? 260} minWidth={0}>
        <AreaChart data={p.data} margin={{ left: -18, right: 8, top: 8 }} accessibilityLayer>
          <CartesianGrid stroke="#eadfd5" vertical={false} />
          <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip /><Legend />
          {p.series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2.25} />)}
        </AreaChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function BarsChart(p: Props) {
  const long = !p.horizontal && p.data.some((r) => String(r.name).length > 7);
  const h = p.horizontal ? Math.max(180, p.data.length * 34 + 40) : p.height ?? 240;
  return (
    <Frame p={p}>
      <ResponsiveContainer width="100%" height={h} minWidth={0}>
        <BarChart data={p.data} layout={p.horizontal ? "vertical" : "horizontal"} margin={{ left: p.horizontal ? 8 : -18, right: 8, top: 8 }} accessibilityLayer>
          <CartesianGrid stroke="#eadfd5" vertical={Boolean(p.horizontal)} horizontal={!p.horizontal} />
          {p.horizontal
            ? (<><XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} /><YAxis type="category" dataKey="name" width={96} tick={axis} tickLine={false} axisLine={false} /></>)
            : (<><XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} interval={0} {...(long ? { angle: -30, textAnchor: "end", height: 56 } : {})} /><YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} /></>)}
          <Tooltip />{p.series.length > 1 && <Legend />}
          {p.series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={p.horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}
