"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Loader2, Send, Sparkles, Square, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RichText } from "@/components/assistant/rich-text";
import { DISCLAIMER } from "@/lib/ai/safety";
import { HELP, SUGGESTIONS } from "@/lib/ai/knowledge";
import type { Role } from "@/lib/nav";
import { cn } from "@/lib/utils";

type Msg = { id: string; role: "user" | "assistant"; text: string; status: "done" | "streaming" | "error" | "stopped"; note?: string; source?: string };
const MAX_STORED = 40;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function AssistantChat({ role, userId }: { role: Role; userId: string }) {
  const storeKey = `dc-ai-chat:${userId}`; // conversation lives only in this browser; nothing is stored server-side
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false); // never write the empty initial state over a saved conversation

  useEffect(() => { // hydrate after mount (localStorage is not available during SSR)
    const t = window.setTimeout(() => {
      try { const saved = JSON.parse(localStorage.getItem(storeKey) ?? "[]") as Msg[]; setMsgs(saved.filter((m) => m.status === "done").slice(-MAX_STORED)); } catch { /* ignore a corrupt store */ }
      hydrated.current = true;
      setOnline(navigator.onLine);
      fetch("/api/ai/chat", { cache: "no-store" }).then((r) => r.json()).then((d) => setConfigured(Boolean(d.configured))).catch(() => setConfigured(null));
    }, 0);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.clearTimeout(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [storeKey]);

  useEffect(() => { // persist finished messages only
    if (busy || !hydrated.current) return;
    try { localStorage.setItem(storeKey, JSON.stringify(msgs.filter((m) => m.status === "done").slice(-MAX_STORED))); } catch { /* storage may be unavailable */ }
  }, [msgs, busy, storeKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const patch = useCallback((id: string, f: (m: Msg) => Msg) => setMsgs((l) => l.map((m) => (m.id === id ? f(m) : m))), []);

  const send = useCallback(async (raw: string, base?: Msg[]) => {
    const text = raw.trim();
    if (!text || busy || !online) return;
    const prior = (base ?? msgs).filter((m) => m.status === "done");
    const user: Msg = { id: uid(), role: "user", text, status: "done" }, bot: Msg = { id: uid(), role: "assistant", text: "", status: "streaming" };
    setMsgs([...prior, user, bot]); setInput(""); setBusy(true); setConfirmClear(false);
    const ac = new AbortController(); abort.current = ac;
    const fail = (message: string) => patch(bot.id, (m) => ({ ...m, status: "error", text: m.text, note: message }));
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ message: text, history: prior.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) })) }) });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); fail(d.message ?? (res.status === 401 ? "Please sign in again." : "The assistant couldn't answer. Please try again.")); return; }
      patch(bot.id, (m) => ({ ...m, source: res.headers.get("x-ai-source") ?? undefined }));
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl; while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; name?: string; code?: string; message?: string };
          if (ev.type === "delta") patch(bot.id, (m) => ({ ...m, text: m.text + (ev.text ?? ""), note: undefined }));
          else if (ev.type === "replace") patch(bot.id, (m) => ({ ...m, text: ev.text ?? "" }));
          else if (ev.type === "tool") patch(bot.id, (m) => ({ ...m, note: "Checking your data…" }));
          else if (ev.type === "done") patch(bot.id, (m) => ({ ...m, status: "done", note: undefined }));
          else if (ev.type === "error") { if (ev.code === "aborted") patch(bot.id, (m) => ({ ...m, status: "stopped" })); else fail(ev.message ?? "Something went wrong."); }
        }
      }
      patch(bot.id, (m) => (m.status === "streaming" ? { ...m, status: m.text ? "done" : "error", note: m.text ? undefined : "No answer was received." } : m));
    } catch (e) {
      if ((e as Error).name === "AbortError") patch(bot.id, (m) => ({ ...m, status: "stopped", note: undefined }));
      else fail(navigator.onLine ? "Couldn't reach the assistant. Please try again." : "You're offline.");
    } finally { setBusy(false); abort.current = null; area.current?.focus(); }
  }, [busy, online, msgs, patch]);

  const retry = (id: string) => { const i = msgs.findIndex((m) => m.id === id); const q = msgs[i - 1]; if (q?.role === "user") void send(q.text, msgs.slice(0, i - 1)); };
  const clear = () => { abort.current?.abort(); setMsgs([]); setConfirmClear(false); try { localStorage.removeItem(storeKey); } catch { /* ignore */ } };
  const state = !online ? "offline" : busy ? "streaming" : configured === false ? "not_configured" : "ready";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]" data-testid="assistant" data-state={state}>
      <Card className="flex min-h-[70dvh] min-w-0 flex-col p-0 lg:min-h-[34rem]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Sparkles className="size-5 text-coral" aria-hidden />Assistant</h2>
          {confirmClear ? (
            <span className="flex items-center gap-2 text-sm" role="group" aria-label="Confirm clearing the chat">Clear this chat?
              <Button size="sm" onClick={clear}>Yes, clear</Button><Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Keep</Button></span>
          ) : <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={msgs.length === 0}><Eraser aria-hidden /> Clear chat</Button>}
        </header>
        <p role="note" className="border-b border-line bg-teal-soft px-4 py-2 text-xs text-teal-900">{DISCLAIMER}</p>
        {!online && <p role="alert" className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900"><WifiOff className="size-4" aria-hidden />You&apos;re offline. You can read the conversation, but sending is paused until you reconnect.</p>}
        {configured === false && <p role="status" className="bg-amber-50 px-4 py-2 text-sm text-amber-900">The AI assistant isn&apos;t configured on this server yet. The quick answers still work.</p>}

        <div role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <div className="grid gap-3">
              <p className="text-sm text-muted">Ask how DonorConnect works, what a status means, or about your own data. I can&apos;t give medical advice.</p>
              <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">{SUGGESTIONS[role].map((s) => <li key={s}><button type="button" className="min-h-10 rounded-full border-[1.5px] border-line bg-white px-3.5 text-left text-sm font-medium hover:border-coral disabled:opacity-50" disabled={busy || !online} onClick={() => void send(s)}>{s}</button></li>)}</ul>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} data-testid={`msg-${m.role}`} data-status={m.status} data-source={m.source} className={cn("max-w-[92%] rounded-2xl px-4 py-2.5 text-[0.95rem]", m.role === "user" ? "ml-auto rounded-br-md bg-navy text-white" : "mr-auto rounded-bl-md border border-line bg-white")}>
              <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
              {m.role === "assistant" ? <RichText text={m.text} /> : <p className="whitespace-pre-wrap break-words">{m.text}</p>}
              {m.status === "streaming" && <span className="flex items-center gap-1.5 pt-1 text-xs text-muted" role="status"><Loader2 className="size-3 animate-spin" aria-hidden />{m.note ?? "Thinking…"}</span>}
              {m.status === "stopped" && <span className="block pt-1 text-xs text-muted">Stopped.</span>}
              {m.status === "error" && (
                <span role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-red-700">{m.note}<Button size="sm" variant="outline" onClick={() => retry(m.id)} disabled={busy || !online}>Retry</Button></span>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <label htmlFor="ai-input" className="sr-only">Your question</label>
          <div className="flex items-end gap-2">
            <textarea id="ai-input" ref={area} value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={1000} disabled={!online}
              placeholder={online ? "Ask a question…  (Enter to send, Shift+Enter for a new line)" : "You're offline"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } else if (e.key === "Escape" && busy) abort.current?.abort(); }}
              className="min-h-12 min-w-0 flex-1 resize-none rounded-xl border-[1.5px] border-line bg-white px-3.5 py-2.5 focus:border-teal" />
            {busy ? <Button type="button" variant="outline" onClick={() => abort.current?.abort()} aria-label="Stop generating"><Square aria-hidden /> Stop</Button>
              : <Button type="submit" disabled={!input.trim() || !online} aria-label="Send message"><Send aria-hidden /> Send</Button>}
          </div>
          <p className="pt-1 text-right text-xs text-muted" aria-hidden>{input.length}/1000</p>
        </form>
      </Card>

      <aside aria-label="Quick answers" className="self-start">
        <Card>
          <h2 className="mb-2 font-display text-lg font-bold">Quick answers</h2>
          <p className="mb-3 text-xs text-muted">Reviewed help that works without the AI.</p>
          <div className="grid gap-2">{Object.values(HELP[role]).map((h) => (
            <details key={h.title} className="rounded-xl border border-line px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-navy">{h.title}</summary><p className="pt-2 text-sm text-muted">{h.body}</p></details>))}</div>
        </Card>
      </aside>
    </div>
  );
}
