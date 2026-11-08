/** Deterministic safety layer. It runs OUTSIDE the model, so a jailbroken or confused model cannot bypass it. */

export const EMERGENCY_MSG = "This could be a medical emergency. Please call your local emergency number or go to the nearest emergency department right now. DonorConnect AI can't help with emergencies.";
export const BOUNDARY_MSG = "I can't make medical decisions. I can't tell you whether you may donate, diagnose a condition, recommend treatment, or confirm that blood is safe or compatible for a transfusion. Those decisions belong to a qualified clinician or your blood service. I can explain how DonorConnect works, what a request status means, or the general (preliminary, educational) blood-group guide.";
export const DISCLAIMER = "AI assistant for using DonorConnect. It gives no medical advice and can make mistakes. In an emergency, call your local emergency number.";

const EMERGENCY = /\b(emergency|ambulance|call (911|999|112|115|1122)|chest pain|can'?t breathe|cannot breathe|difficulty breathing|trouble breathing|unconscious|passed out|severe bleeding|heavy bleeding|bleeding (heavily|badly|a lot|won'?t stop)|overdos\w*|suicid\w*|want to die|kill myself|self[- ]?harm|stroke|seizure|anaphyla\w*|heart attack|poison\w*|dying)\b/i;
const MEDICAL_DECISION: RegExp[] = [
  /\b(am i|can i|may i|should i|do i|could i|will i|is it (safe|ok|okay) for me)\b.{0,60}\b(eligible|qualify|allowed|permitted|donate|donating|give blood)\b/i,           // "can I donate?"
  /\b(my|i have|i('m| am) (on|taking|pregnant|sick|ill)|diagnosed)\b.{0,60}\b(blood pressure|haemoglobin|hemoglobin|iron|medication|medicine|tattoo|pregnan\w*|diabet\w*|cancer|hiv|hepatitis|anaemi\w*|anemi\w*|fever|infection)\b/i,
  /\b(can|should|am i|is it safe for) (i|me|my (mother|father|mom|dad|child|son|daughter|wife|husband|brother|sister|friend|patient))\b.{0,50}\b(receive|get|take|have|be given|need)\b.{0,30}\b(blood|transfusion|platelets|plasma)\b/i,
  /\bdo (i|they|he|she) need (a )?(blood|transfusion)\b/i,
  /\b(diagnos\w*|prescri\w*|dosage|which (medicine|medication|drug)|treatment (for|plan)|what (disease|condition|illness)|do i have (an?|the)?\s*\w+|my (lab|test|blood) results?)\b/i,
  /\b(is|are) (this|that|the) (blood|unit|donor)\b.{0,30}\b(safe|compatible|ok|okay|suitable)\b.{0,20}\b(for|with) (me|my|him|her|them|the patient)\b/i,
];
export type Verdict = "emergency" | "medical_decision" | "ok";
export const classifyMessage = (text: string): Verdict => (EMERGENCY.test(text) ? "emergency" : MEDICAL_DECISION.some((r) => r.test(text)) ? "medical_decision" : "ok");

/** Strip control / zero-width / bidi characters and cap length. Applies to anything that goes into a prompt. */
export const sanitizeText = (s: unknown, max = 1000): string =>
  String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
/** Free-text fields from the database (e.g. a city typed by a user) are untrusted: one short, single line. */
export const cleanField = (s: unknown, max = 40) => sanitizeText(s, max).replace(/\s*\n\s*/g, " ");

const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Last line of defence: contact details and internal ids never reach the user from the model, whatever it was tricked into saying. */
export function redactOutput(text: string): string {
  return text
    .replace(EMAIL, "[hidden]")
    .replace(UUID, "[id hidden]")
    .replace(PHONE, (m) => { const digits = m.replace(/\D/g, "").length; return digits >= 8 && !/^\d{4}-\d{2}-\d{2}$/.test(m.trim()) ? "[hidden]" : m; });
}

const FORBIDDEN_CLAIMS: RegExp[] = [
  /\byou(?:'re| are) (?:eligible|cleared|fit|healthy enough|allowed) to (?:donate|give blood)\b/i,
  /\b(?:it(?:'s| is)|that(?:'s| is)) (?:safe|ok|okay|fine) (?:for you )?to (?:receive|get|be given|donate)\b/i,
  /\b(?:this|that|the) (?:blood|unit|donor) is (?:a )?(?:confirmed|guaranteed|safe|approved)(?: match| for)?/i,
  /\b(?:i|we)(?:'ve| have)? (?:approved|rejected|cancelled|canceled|invited|sent|shared|disclosed) (?:your|the|a|that|their)\b/i,
  /\b(?:i|we) (?:will|can) (?:approve|reject|cancel|invite|share|disclose)\b/i,
];
/** True if the model asserted a medical decision or claimed to perform an action only the app workflows may perform. */
export const violatesPolicy = (text: string) => FORBIDDEN_CLAIMS.some((r) => r.test(text));

/** Streams text through redaction with a hold-back window so a phone number or email split across chunks is still caught. */
export class OutputGuard {
  private buf = "";
  constructor(private hold = 48) {}
  push(chunk: string): string {
    this.buf += chunk;
    const limit = this.buf.length - this.hold;
    if (limit <= 0) return "";
    let cut = this.buf.lastIndexOf(" ", limit);
    while (cut > 0 && /[\d)+-]/.test(this.buf[cut - 1])) cut = this.buf.lastIndexOf(" ", cut - 1); // never cut inside a possible phone number ("+92 300 1234567")
    if (cut <= 0) return "";
    const out = this.buf.slice(0, cut + 1);
    this.buf = this.buf.slice(cut + 1);
    return redactOutput(out);
  }
  flush(): string { const out = redactOutput(this.buf); this.buf = ""; return out; }
}
