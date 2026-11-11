"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/notifications";

export type Notif = { id: number; message: string; link: string | null; is_read: boolean; created_at: string; category: string };
export type LiveStatus = "connecting" | "live" | "polling" | "offline";
type Ctx = { items: Notif[]; unread: number; status: LiveStatus; loading: boolean; error: string | null; refresh: () => Promise<void>; markRead: (id: number) => Promise<void>; markAll: () => Promise<void> };
const NotificationsContext = createContext<Ctx | null>(null);
export const useNotifications = () => useContext(NotificationsContext);

const POLL_FALLBACK_MS = 20_000; // used whenever realtime is not connected
const POLL_LIVE_MS = 120_000;    // safety net while realtime is connected

/** Source of truth for the bell badge and the notification center.
 *  Realtime (a private per-user channel carrying only a notification id) is a *hint*: every update re-reads /api/notifications,
 *  so data is always re-authorized server-side. If realtime is unavailable the provider falls back to polling + refresh-on-focus. */
export function NotificationsProvider({ initialUnread, children }: { initialUnread: number; children: React.ReactNode }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);       // only the newest response may be applied (out-of-order responses are dropped)
  const inFlight = useRef(0);  // while a mark-read mutation is running, any response may predate it, so it is dropped and we re-sync afterwards

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (mine !== seq.current || inFlight.current > 0) return;
      if (r.status === 401) { setError("Your session has expired. Please sign in again."); return; }
      if (!r.ok) throw new Error("bad status");
      const d = (await r.json()) as { items: Notif[]; unread: number };
      if (mine !== seq.current || inFlight.current > 0) return;
      setItems(d.items); setUnread(d.unread); setError(null);
    } catch {
      setError(navigator.onLine ? "We couldn't refresh your notifications." : null); // offline is shown by its own banner
    } finally { setLoading(false); }
  }, []);

  // polling fallback + refresh when the tab regains focus or the network returns
  useEffect(() => {
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, status === "live" ? POLL_LIVE_MS : POLL_FALLBACK_MS);
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake); window.addEventListener("online", wake);
    return () => { window.clearTimeout(first); window.clearInterval(t); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
  }, [refresh, status]);

  // realtime: private channel, exponential-backoff reconnect, token renewal, catch-up refresh on every (re)subscribe
  useEffect(() => {
    let stopped = false, client: SupabaseClient | null = null, retry: number | undefined, renew: number | undefined, attempt = 0;
    const schedule = () => { window.clearTimeout(retry); attempt += 1; retry = window.setTimeout(connect, Math.min(60_000, 3_000 * 2 ** Math.min(attempt, 5))); };
    async function connect() {
      if (stopped) return;
      if (!navigator.onLine) { setStatus("offline"); return; }
      try {
        const r = await fetch("/api/notifications/realtime", { cache: "no-store" });
        if (!r.ok) throw new Error("token");
        const { url, anonKey, token, topic } = (await r.json()) as { url: string; anonKey: string; token: string; topic: string };
        const { createClient } = await import("@supabase/supabase-js");
        if (stopped) return;
        if (client) { await client.removeAllChannels(); await client.realtime.disconnect(); }
        client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        await client.realtime.setAuth(token);
        client.channel(topic, { config: { private: true } })
          .on("broadcast", { event: "notification" }, () => { void refresh(); })
          .subscribe((st) => {
            if (stopped) return;
            if (st === "SUBSCRIBED") { attempt = 0; setStatus("live"); void refresh(); }
            else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") { setStatus(navigator.onLine ? "polling" : "offline"); schedule(); }
          });
        window.clearTimeout(renew); renew = window.setTimeout(() => { void connect(); }, 50 * 60_000); // access tokens last about an hour
      } catch { setStatus(navigator.onLine ? "polling" : "offline"); schedule(); }
    }
    const online = () => { attempt = 0; setStatus("connecting"); void connect(); };
    const offline = () => setStatus("offline");
    void connect();
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { stopped = true; window.clearTimeout(retry); window.clearTimeout(renew); window.removeEventListener("online", online); window.removeEventListener("offline", offline); void client?.removeAllChannels(); void client?.realtime.disconnect(); };
  }, [refresh]);

  const markRead = useCallback(async (id: number) => {
    setItems((l) => l.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    inFlight.current++;
    try { await markNotificationReadAction(id); } finally { inFlight.current--; }
    void refresh(); // re-sync with the server's truth once the write has landed
  }, [refresh]);
  const markAll = useCallback(async () => {
    setItems((l) => l.map((n) => ({ ...n, is_read: true }))); setUnread(0);
    inFlight.current++;
    try { await markAllNotificationsReadAction(); } finally { inFlight.current--; }
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ items, unread, status, loading, error, refresh, markRead, markAll }), [items, unread, status, loading, error, refresh, markRead, markAll]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
