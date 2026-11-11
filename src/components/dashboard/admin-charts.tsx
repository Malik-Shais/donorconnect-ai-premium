"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { devPerDay, devSupplyDemand } from "@/lib/dev-data";
import { Card, CardTitle } from "@/components/ui/card";

const axis = { fontSize: 12, fill: "#5b6b7e" };

export function AdminCharts() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardTitle>Requests, last 14 days</CardTitle>
        <div role="img" aria-label="Area chart of requests per day (fictional data)">
          <ResponsiveContainer width="100%" height={240} minWidth={0}>
            <AreaChart data={devPerDay} margin={{ left: -20, right: 8, top: 8 }}>
              <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6b5b" stopOpacity={0.5} /><stop offset="1" stopColor="#ff6b5b" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid stroke="#eadfd5" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip /><Area type="monotone" dataKey="requests" stroke="#7a1630" strokeWidth={2.5} fill="url(#fill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <CardTitle>Supply vs demand by blood group</CardTitle>
        <div role="img" aria-label="Bar chart of compatible donors versus open units by blood group (fictional data)">
          <ResponsiveContainer width="100%" height={240} minWidth={0}>
            <BarChart data={devSupplyDemand} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid stroke="#eadfd5" vertical={false} />
              <XAxis dataKey="group" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip /><Legend />
              <Bar dataKey="donors" name="Available donors" fill="#0e8f9b" radius={[6, 6, 0, 0]} />
              <Bar dataKey="units" name="Units needed" fill="#7a1630" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
