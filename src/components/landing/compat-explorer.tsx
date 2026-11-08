"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { canGiveTo, canReceiveFrom, GROUPS, type Group } from "@/lib/compat";
import { cn } from "@/lib/utils";

export function CompatExplorer() {
  const [group, setGroup] = useState<Group>("O-");
  const [mode, setMode] = useState<"give" | "receive">("give");
  const result = mode === "give" ? canGiveTo(group) : canReceiveFrom(group);

  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-card md:p-8">
      <div role="group" aria-label="Choose a mode" className="mb-5 inline-flex rounded-full bg-offwhite p-1">
        {(["give", "receive"] as const).map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}
            className={cn("min-h-10 rounded-full px-5 text-sm font-semibold transition-colors", mode === m ? "bg-navy text-white" : "text-navy")}>
            {m === "give" ? "I could donate" : "I need blood"}
          </button>
        ))}
      </div>
      <p className="mb-2 text-sm font-semibold text-navy">My blood group</p>
      <div className="mb-6 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {GROUPS.map((g) => (
          <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}
            className={cn("min-h-11 rounded-xl border-[1.5px] font-display text-lg font-bold transition-all", group === g ? "border-burgundy bg-burgundy text-white" : "border-line bg-white text-burgundy hover:border-coral")}>
            {g}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted" aria-live="polite">
        {mode === "give" ? `${group} red cells can preliminarily go to:` : `${group} recipients can preliminarily receive from:`}
      </p>
      <div className="flex flex-wrap gap-2" aria-live="polite">
        {result.map((g, i) => (
          <motion.span key={`${mode}-${group}-${g}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
            className="grid h-11 min-w-14 place-items-center rounded-xl bg-teal-soft px-3 font-display text-lg font-bold text-teal-900">{g}</motion.span>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted">Preliminary guide only. Blood services confirm real compatibility and who may donate.</p>
    </div>
  );
}
