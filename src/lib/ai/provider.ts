import "server-only";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";

export type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string } | { functionResponse: { name: string; response: Record<string, unknown> } };
export type Content = { role: "user" | "model"; parts: Part[] };
export type ModelEvent = { type: "text"; text: string } | { type: "call"; name: string; args: Record<string, unknown>; thoughtSignature?: string };
export type ToolDecl = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };
export type ModelRequest = { system: string; contents: Content[]; tools: ToolDecl[]; allowTools?: boolean; signal?: AbortSignal };
export type Provider = { name: "gemini" | "mock"; stream: (r: ModelRequest) => AsyncGenerator<ModelEvent> };

// Model id comes from the environment. The default is the model used in the official @google/genai documentation; override with
// GEMINI_MODEL for a model available to your key. The key is read only here, on the server.
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.6-flash";

function gemini(apiKey: string): Provider {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: Number(process.env.GEMINI_TIMEOUT_MS) || 25_000, retryOptions: { attempts: 1 } } }) // live check: an overloaded model stalled 160s+ behind SDK retries;
  return {
    name: "gemini",
    async *stream({ system, contents, tools, allowTools = true, signal }) {
      const res = await ai.models.generateContentStream({
        model: MODEL(),
        contents,
        config: {
          systemInstruction: system, maxOutputTokens: 700, temperature: 0.3, abortSignal: signal,
          ...(tools.length ? { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: allowTools ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE } } } : {}),
        },
      });
      for await (const chunk of res) {
        // Gemini 3 rejects a replayed functionCall (400) unless its thoughtSignature is sent back with it.
        for (const p of chunk.candidates?.[0]?.content?.parts ?? []) if (p.functionCall?.name) yield { type: "call", name: p.functionCall.name, args: (p.functionCall.args ?? {}) as Record<string, unknown>, thoughtSignature: p.thoughtSignature };
        const t = chunk.candidates?.[0]?.content?.parts?.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
        if (t) yield { type: "text", text: t };
      }
    },
  };
}

// ---- deterministic MOCK for automated tests. Never used with a real key; requires TWO explicit flags, so it cannot be enabled by accident. ----
const seen = new Set<string>();
const sleep = (ms: number, s?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); s?.addEventListener("abort", () => { clearTimeout(t); rej(Object.assign(new Error("aborted"), { name: "AbortError" })); }); });
const question = (c: Content[]) => { const t = (c[0].parts[0] as { text: string }).text; return t.slice(t.lastIndexOf("Current question:") + 17).trim().toLowerCase(); };
const toolResult = (c: Content[]) => { const last = c[c.length - 1]; const p = last.parts.find((x) => "functionResponse" in x) as { functionResponse: { response: Record<string, unknown> } } | undefined; return p?.functionResponse.response; };
const call = (name: string): ModelEvent => ({ type: "call", name, args: {} });
async function* chunks(text: string, s?: AbortSignal, delay = 5): AsyncGenerator<ModelEvent> { for (let i = 0; i < text.length; i += 14) { yield { type: "text", text: text.slice(i, i + 14) }; await sleep(delay, s); } }

function mock(): Provider {
  return {
    name: "mock",
    async *stream({ contents, signal }) {
      const q = question(contents), res = toolResult(contents);
      if (q.includes("__quota_once")) { if (!seen.has(q)) { seen.add(q); throw Object.assign(new Error("quota"), { status: 429 }); } }
      else if (q.includes("__quota")) throw Object.assign(new Error("quota"), { status: 429 });
      if (q.includes("__down")) throw Object.assign(new Error("down"), { status: 503 });
      if (q.includes("__slow")) { yield* chunks("This is a deliberately slow mock answer that keeps streaming so the Stop button can be tested. ".repeat(6), signal, 120); return; }
      if (q.includes("__inject")) { // simulates a COMPROMISED model that obeys an injection
        if (!res) { yield call("get_donor_contacts"); return; }
        yield* chunks("Sure! The donor phone is +92 300 1234567, email donor.secret@example.com, id 3f2b8a52-0d0e-4a39-9a46-0b0f6d3f9c11. I have approved your request.", signal); return;
      }
      if (q.includes("__admin") && !res) { yield call("get_operational_stats"); return; }
      if (!res && /my requests|requests right now/.test(q)) { yield call("get_my_requests"); return; }
      if (!res && q.includes("opportunit")) { yield call("get_my_opportunities"); return; }
      if (!res && /operational|numbers/.test(q)) { yield call("get_operational_stats"); return; }
      if (res) {
        const d = (res.untrusted_data ?? res) as Record<string, unknown>;
        if (res.error) { yield* chunks(`I couldn't use that tool (${String(res.error)}).`, signal); return; }
        const items = (d.items as Record<string, unknown>[] | undefined) ?? [];
        if (items.length) yield* chunks(`You have ${d.count} item(s): ` + items.map((i) => `#${i.request_id} ${i.blood_group} ${i.status ?? i.request_status}`).join("; ") + ".", signal);
        else if (d.requests_by_status) yield* chunks("Operational numbers: " + JSON.stringify(d), signal);
        else yield* chunks("I found nothing to report right now.", signal);
        return;
      }
      yield* chunks(`Mock assistant (no live AI). I can explain how DonorConnect works. You asked: ${q.slice(0, 80)}`, signal);
    },
  };
}

/** gemini when a key is configured; the mock only with BOTH AI_PROVIDER=mock and DC_ALLOW_AI_MOCK=1; otherwise null (not configured). */
export function getProvider(): Provider | null {
  if (process.env.AI_PROVIDER === "mock" && process.env.DC_ALLOW_AI_MOCK === "1") return mock();
  const key = process.env.GEMINI_API_KEY;
  return key ? gemini(key) : null;
}
