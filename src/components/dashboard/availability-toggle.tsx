"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function AvailabilityToggle() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-semibold text-navy" id="avail-label">Available to be contacted</p>
        <p className="text-sm text-muted">{on ? "You appear in preliminary matches." : "You are hidden from matches."}</p>
      </div>
      <button role="switch" aria-checked={on} aria-labelledby="avail-label" onClick={() => setOn(!on)}
        className={cn("relative h-8 w-14 shrink-0 rounded-full transition-colors", on ? "bg-emerald-600" : "bg-slate-300")}>
        <span className={cn("absolute left-1 top-1 size-6 rounded-full bg-white shadow transition-transform", on && "translate-x-6")} />
      </button>
    </div>
  );
}
