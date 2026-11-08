"use client";
import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

/** Demo mode: local state only. Real mode: pass `save` (a server action) and the value is persisted, reverting on failure. */
export function AvailabilityToggle({ initial = true, save }: { initial?: boolean; save?: (v: boolean) => Promise<{ ok: boolean }> }) {
  const [saved, setSaved] = useState(initial);
  const [on, setOn] = useOptimistic(saved);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const toggle = () => {
    const next = !on;
    setErr("");
    start(async () => {
      setOn(next);
      if (!save) return setSaved(next);
      const r = await save(next);
      if (r.ok) setSaved(next); else setErr("Couldn't save. Please try again.");
    });
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-navy" id="avail-label">Available to be contacted</p>
          <p className="text-sm text-muted">{on ? "You appear in preliminary matches." : "You are hidden from matches."}</p>
        </div>
        <button role="switch" aria-checked={on} aria-labelledby="avail-label" onClick={toggle} disabled={pending}
          className={cn("relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-70", on ? "bg-emerald-600" : "bg-slate-300")}>
          <span className={cn("absolute left-1 top-1 size-6 rounded-full bg-white shadow transition-transform", on && "translate-x-6")} />
        </button>
      </div>
      {err && <p role="alert" className="pt-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
