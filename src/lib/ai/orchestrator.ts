import { BOUNDARY_MSG, EMERGENCY_MSG, OutputGuard, classifyMessage, sanitizeText, violatesPolicy } from "@/lib/ai/safety";
import { systemInstruction, userTurnText, type Turn } from "@/lib/ai/prompt";
import type { Content, ModelEvent, Provider, ToolDecl } from "@/lib/ai/provider";
import type { Role } from "@/lib/nav";

export type AiErrorCode = "not_configured" | "quota" | "unavailable" | "auth" | "aborted" | "internal";
export type AssistantEvent =
  | { type: "delta"; text: string } | { type: "replace"; text: string } | { type: "tool"; name: string }
  | { type: "done"; source: "gemini" | "mock" | "safety" } | { type: "error"; code: AiErrorCode; message: string };

export const ERROR_TEXT: Record<AiErrorCode, string> = {
  not_configured: "The AI assistant isn't configured on this server yet. The quick answers below still work.",
  quota: "The assistant has reached its usage limit for now. Please try again later; the rest of DonorConnect works as usual.",
  unavailable: "The assistant is temporarily unavailable. Please try again in a moment.",
  auth: "The assistant isn't set up correctly (its credentials were rejected). Please tell an administrator.",
  aborted: "Stopped.",
  internal: "Something went wrong. Please try again.",
};
/** Provider errors are mapped to a small, safe vocabulary: raw SDK/API messages are never shown to users or logged with content. */
export function classifyError(e: unknown, aborted: boolean): AiErrorCode {
  if (aborted) return "aborted"; // only a user Stop; an SDK timeout is also an AbortError but must read as "unavailable"
  const status = Number((e as { status?: number })?.status ?? 0);
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(String((e as Error)?.message))) return "auth"; // Google answers a bad key with 400
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500 || status === 400 || status === 404 || status === 0) return "unavailable";
  return "internal";
}

const MAX_ROUNDS = 3, MAX_CALLS_PER_ROUND = 4;
export type RunInput = { role: Role; message: string; history: Turn[]; provider: Provider | null; tools: ToolDecl[]; execTool: (name: string, args: unknown) => Promise<unknown>; signal?: AbortSignal };

export async function* runAssistant({ role, message, history, provider, tools, execTool, signal }: RunInput): AsyncGenerator<AssistantEvent> {
  const msg = sanitizeText(message, 1000);
  // 1) Deterministic safety short-circuit: the model is never consulted for emergencies or personal medical decisions.
  const verdict = classifyMessage(msg);
  if (verdict !== "ok") { yield { type: "delta", text: verdict === "emergency" ? EMERGENCY_MSG : BOUNDARY_MSG }; yield { type: "done", source: "safety" }; return; }
  if (!provider) { yield { type: "error", code: "not_configured", message: ERROR_TEXT.not_configured }; return; }

  const contents: Content[] = [{ role: "user", parts: [{ text: userTurnText(history, msg) }] }];
  const system = systemInstruction(role);
  let all = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const guard = new OutputGuard(), calls: Extract<ModelEvent, { type: "call" }>[] = [];
      for await (const ev of provider.stream({ system, contents, tools, signal })) {
        if (ev.type === "text") { const out = guard.push(ev.text); if (out) { all += out; yield { type: "delta", text: out }; } }
        else calls.push(ev);
      }
      const tail = guard.flush();
      if (tail) { all += tail; yield { type: "delta", text: tail }; }
      if (calls.length === 0) {
        // 2) Output policy: the model may not assert medical decisions or claim to have performed app actions.
        if (violatesPolicy(all)) yield { type: "replace", text: BOUNDARY_MSG };
        yield { type: "done", source: provider.name };
        return;
      }
      const used = calls.slice(0, MAX_CALLS_PER_ROUND);
      contents.push({ role: "model", parts: used.map((c) => ({ functionCall: { name: c.name, args: c.args }, ...(c.thoughtSignature && { thoughtSignature: c.thoughtSignature }) })) });
      const responses: Content["parts"] = [];
      for (const c of used) {
        yield { type: "tool", name: c.name };
        const r = await execTool(c.name, c.args); // permission + whitelist enforced inside the executor
        responses.push({ functionResponse: { name: c.name, response: (r && typeof r === "object" ? r : { value: r }) as Record<string, unknown> } });
      }
      contents.push({ role: "user", parts: responses });
    }
    yield { type: "delta", text: "I couldn't finish that. Please try a simpler question." };
    yield { type: "done", source: provider.name };
  } catch (e) {
    const code = classifyError(e, Boolean(signal?.aborted));
    yield { type: "error", code, message: ERROR_TEXT[code] };
  }
}
