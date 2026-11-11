import { Badge } from "@/components/ui/badge";
import { statusTone, urgencyTone, type DevRequest } from "@/lib/dev-data";

export const RequestRow = ({ r }: { r: DevRequest }) => (
  <li className="flex flex-wrap items-center justify-between gap-3 py-3">
    <div className="flex items-center gap-3">
      <span className="grid h-9 min-w-12 place-items-center rounded-xl bg-burgundy px-2 font-display font-bold text-white" aria-label={`Blood group ${r.group}`}>{r.group}</span>
      <div>
        <p className="font-semibold">{r.units} unit{r.units > 1 ? "s" : ""} · {r.hospital}</p>
        <p className="text-sm text-muted">{r.city} · {r.ago}</p>
      </div>
    </div>
    <div className="flex gap-1.5"><Badge tone={urgencyTone[r.urgency]}>{r.urgency}</Badge><Badge tone={statusTone[r.status]}>{r.status}</Badge></div>
  </li>
);
