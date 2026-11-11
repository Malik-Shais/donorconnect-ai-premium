"use client";
import Link from "@/components/dashboard/link";
import { useActionState, useState } from "react";
import { Bell, CheckCheck, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FormAlert, SubmitButton } from "@/components/forms";
import { saveNotificationPrefsAction } from "@/app/actions/notifications";
import { useNotifications, type Notif } from "@/components/notifications/provider";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = { request: "Requests", offer: "Offers", invitation: "Invitations", review: "Review queue", account: "Account" };
const TONE: Record<string, string> = { request: "bg-sky-100 text-sky-800", offer: "bg-emerald-100 text-emerald-800", invitation: "bg-amber-100 text-amber-800", review: "bg-red-100 text-red-700", account: "bg-navy/10 text-navy" };

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - now) / 1000), rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, secs] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  return "just now";
}

const STATUS_TEXT = { live: "Live updates on", polling: "Live updates unavailable: checking every 20 seconds", connecting: "Connecting…", offline: "You're offline" } as const;

export function NotificationCenter({ role, prefs }: { role: string; prefs: { email_enabled: boolean; email_categories: string[] } }) {
  const n = useNotifications();
  const [filter, setFilter] = useState<string>("all");
  if (!n) return null;
  const { items, unread, status, loading, error, refresh, markRead, markAll } = n;
  const present = [...new Set(items.map((i) => i.category))];
  const shown = items.filter((i) => (filter === "all" ? true : filter === "unread" ? !i.is_read : i.category === filter));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <Button size="sm" variant="outline" onClick={() => void markAll()} disabled={unread === 0}><CheckCheck aria-hidden /> Mark all as read</Button>
      </div>
      <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span aria-live="polite" data-testid="unread-summary">{unread === 0 ? "You're all caught up." : `${unread} unread`}</span>
        <span role="status" data-testid="live-status" data-state={status} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("size-2 rounded-full", status === "live" ? "bg-emerald-500" : status === "offline" ? "bg-red-500" : "bg-amber-500")} />{STATUS_TEXT[status]}</span>
      </p>
      {status === "offline" && <p role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><WifiOff className="size-4 shrink-0" aria-hidden />You&apos;re offline. These are the notifications we last loaded; they&apos;ll refresh when you reconnect.</p>}
      {error && status !== "offline" && <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}<Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw aria-hidden /> Try again</Button></p>}

      <nav aria-label="Filter notifications" className="mb-4 flex flex-wrap gap-2">
        {[["all", "All"], ["unread", `Unread${unread ? ` (${unread})` : ""}`], ...present.map((c) => [c, LABEL[c] ?? c])].map(([k, v]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn("min-h-9 rounded-full border px-3.5 text-sm font-semibold", filter === k ? "border-burgundy bg-burgundy text-white" : "border-line bg-white text-navy hover:border-coral")}>{v}</button>
        ))}
      </nav>

      {loading && items.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Loading notifications" className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-line/60" />)}</div>
      ) : shown.length === 0 ? (
        <Card><p className="py-6 text-center text-sm text-muted"><Bell className="mx-auto mb-2 size-6" aria-hidden />{items.length === 0 ? "No notifications yet. We'll let you know when something needs your attention." : "No notifications match this filter."}</p></Card>
      ) : (
        <ul className="grid gap-3" aria-label="Notifications">{shown.map((i) => <Item key={i.id} n={i} onRead={markRead} />)}</ul>
      )}

      <Settings role={role} initial={prefs} />
    </>
  );
}

function Item({ n, onRead }: { n: Notif; onRead: (id: number) => Promise<void> }) {
  const text = n.link ? <Link href={n.link} onClick={() => { if (!n.is_read) void onRead(n.id); }} className="font-medium hover:underline">{n.message}</Link> : <span className="font-medium">{n.message}</span>;
  return (
    <li data-unread={!n.is_read} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white p-4 shadow-card", n.is_read ? "border-line" : "border-l-4 border-coral")}>
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex flex-wrap items-center gap-2 text-xs"><span className={cn("rounded-full px-2.5 py-0.5 font-semibold", TONE[n.category] ?? TONE.account)}>{LABEL[n.category] ?? n.category}</span>
          <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString()} className="text-muted">{timeAgo(n.created_at)}</time>{!n.is_read && <span className="font-semibold text-burgundy">New</span>}</p>
        <p className="break-words">{text}</p>
      </div>
      {!n.is_read && <Button size="sm" variant="ghost" onClick={() => void onRead(n.id)} aria-label={`Mark as read: ${n.message}`}>Mark as read</Button>}
    </li>
  );
}

function Settings({ role, initial }: { role: string; initial: { email_enabled: boolean; email_categories: string[] } }) {
  const [state, action] = useActionState(saveNotificationPrefsAction, undefined);
  const cats = role === "admin" ? ["request", "offer", "invitation", "review", "account"] : ["request", "offer", "invitation", "account"];
  return (
    <Card className="mt-8 max-w-xl">
      <CardTitle>Notification settings</CardTitle>
      <p className="mb-4 text-sm text-muted">In-app notifications are always on. Email is optional and off by default. Emails are generic (they never include patient, request or contact details): they only tell you to open the app.</p>
      <form action={action} className="grid gap-4">
        <label className="flex items-center gap-3 font-semibold text-navy"><input type="checkbox" name="email_enabled" defaultChecked={initial.email_enabled} className="size-5 accent-burgundy" /> Email me about new notifications</label>
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold text-navy">Email me about</legend>
          {cats.map((c) => <label key={c} className="flex items-center gap-3 text-sm"><input type="checkbox" name="cat" value={c} defaultChecked={initial.email_categories.includes(c)} className="size-5 accent-burgundy" /> {LABEL[c]}</label>)}</fieldset>
        <FormAlert state={state} />
        <SubmitButton className="w-fit">Save settings</SubmitButton>
      </form>
    </Card>
  );
}
