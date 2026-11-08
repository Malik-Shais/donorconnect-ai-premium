import { REQUEST_LABEL, StatusBadge } from "@/components/status-badge";
import type { RequestEvent } from "@/lib/types";

const STEP: Record<string, string> = { pending_review: "Submitted for review", approved: "Approved by the review team", rejected: "Rejected by the review team", matched: "A donor accepted", fulfilled: "Marked fulfilled", cancelled: "Cancelled" };
export function Timeline({ events }: { events: RequestEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol aria-label="Request activity" className="relative grid gap-5 border-l-2 border-line pl-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span aria-hidden className="absolute -left-[1.62rem] top-1.5 size-3 rounded-full border-2 border-white bg-coral" />
          <p className="flex flex-wrap items-center gap-2 font-semibold"><StatusBadge status={e.status} /> {STEP[e.status] ?? REQUEST_LABEL[e.status]}</p>
          <p className="text-xs text-muted">{new Date(e.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
          {e.note && <p className="mt-1 text-sm">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}
