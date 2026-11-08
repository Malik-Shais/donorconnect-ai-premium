import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { anonLimit } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { runAssistant } from "@/lib/ai/orchestrator";
import { getProvider } from "@/lib/ai/provider";
import { classifyMessage } from "@/lib/ai/safety";
import { runTool, toolDeclarations } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const H = { "Cache-Control": "no-store, private" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: H });

const Body = z.object({
  message: z.string().trim().min(1, "Type a question first.").max(1000, "Please keep questions under 1000 characters."),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(20).default([]),
});

export async function GET() {
  const s = await getSession();
  if (!s || s.profile.suspended) return json({ error: "unauthenticated" }, 401);
  const p = getProvider();
  return json({ configured: Boolean(p), provider: p?.name ?? null }, 200);
}

export async function POST(request: Request) {
  // CSRF defence in depth (session cookies are also SameSite): same-origin requests only, JSON only, bounded size.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json({ error: "forbidden" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "bad_request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > 30_000) return json({ error: "too_large" }, 413);

  const s = await getSession();
  if (!s) return json({ error: "unauthenticated", message: "Please sign in again." }, 401);
  if (s.profile.suspended) return json({ error: "forbidden" }, 403);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
  const { message, history } = parsed.data;

  const supabase = await createClient(); // the USER's client: tools and rate limits run with the user's own permissions
  const lim = await supabase.rpc("check_rate_limit", { p_action: "ai.chat" }); // PostgreSQL-backed, atomic, per user
  if (lim.error) return lim.error.code === "PT429" ? json({ error: "rate_limited", message: lim.error.message }, 429) : json({ error: "unavailable", message: "Please try again in a moment." }, 503);

  const safety = classifyMessage(message) !== "ok";
  if (!safety && getProvider()?.name === "gemini") { // project-wide free-tier budget guard: real Gemini calls only
    if (await anonLimit("ai.global", "global")) return json({ error: "busy", message: "The assistant is busy right now. Please try again in a few minutes." }, 503);
  }

  const provider = getProvider(), role = s.profile.role, ctx = { role, supabase };
  const enc = new TextEncoder(), ac = new AbortController();
  request.signal.addEventListener("abort", () => ac.abort());
  const stream = new ReadableStream({
    async start(controller) {
      for await (const ev of runAssistant({ role, message, history, provider, tools: toolDeclarations(role), execTool: (n, a) => runTool(n, a, ctx), signal: ac.signal }))
        controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      controller.close();
    },
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { ...H, "Content-Type": "application/x-ndjson; charset=utf-8", "X-AI-Source": safety ? "safety" : provider?.name ?? "none" } });
}
