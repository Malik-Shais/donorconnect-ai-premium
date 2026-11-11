"use client";
// Recharts lives ONLY in this module so its (large) bundle is fetched when a chart scrolls near the viewport, not on first load.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Series } from "@/components/analytics/charts";

const axis = { fontSize: 12, fill: "#4d5d70" };
type P = { data: Record<string, string | number>[]; series: Series[]; height: number; horizontal?: boolean };

export function TrendPlot({ data, series, height }: P) {
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0}>
      <AreaChart data={data} margin={{ left: -18, right: 8, top: 8 }} accessibilityLayer>
        <CartesianGrid stroke="#eadfd5" vertical={false} />
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip /><Legend />
        {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2.25} isAnimationActive={false} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsPlot({ data, series, height, horizontal }: P) {
  const long = !horizontal && data.some((r) => String(r.name).length > 7);
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 8 : -18, right: 8, top: 8 }} accessibilityLayer>
        <CartesianGrid stroke="#eadfd5" vertical={Boolean(horizontal)} horizontal={!horizontal} />
        {horizontal
          ? (<><XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} /><YAxis type="category" dataKey="name" width={96} tick={axis} tickLine={false} axisLine={false} /></>)
          : (<><XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} interval={0} {...(long ? { angle: -30, textAnchor: "end", height: 56 } : {})} /><YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} /></>)}
        <Tooltip />{series.length > 1 && <Legend />}
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
