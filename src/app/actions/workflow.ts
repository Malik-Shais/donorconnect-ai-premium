"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { rpc } from "@/lib/rpc";
import { consentSchema, eligibilitySchema, fieldErrors, inviteSchema, offerSchema, requestIdSchema, reviewSchema, suspendSchema, transitionSchema, type FormState } from "@/lib/validation";
import type { Role } from "@/lib/nav";

// Every action: (1) verify the signed-in role, (2) validate input, (3) call a narrowly-scoped SQL function that
// re-authorises and enforces the state machine. The UI is never trusted.
async function guard(...roles: Role[]) {
  const s = await requireSession();
  return roles.includes(s.profile.role) ? s : null;
}
const DENIED: FormState = { error: "You are not allowed to do that." };
const ok = (message: string): FormState => { revalidatePath("/dashboard", "layout"); return { message }; };
const bad = <T>(r: z.ZodSafeParseError<T>): FormState => ({ error: Object.values(fieldErrors(r.error))[0] ?? "Check your input", fields: fieldErrors(r.error) });

export async function transitionRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("requester", "admin"))) return DENIED;
  const p = transitionSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("transition_request", { p_id: p.data.id, p_to: p.data.to, p_note: p.data.note ?? null });
  return r.error ? { error: r.error } : ok(p.data.to === "fulfilled" ? "Request marked as fulfilled." : "Request cancelled.");
}

export async function moderateCancelAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("admin"))) return DENIED;
  const p = transitionSchema.safeParse({ ...Object.fromEntries(fd), to: "cancelled" }); if (!p.success) return bad(p);
  if (!p.data.note || p.data.note.length < 5) return { error: "A moderation note (at least 5 characters) is required." };
  const r = await rpc("transition_request", { p_id: p.data.id, p_to: "cancelled", p_note: p.data.note });
  return r.error ? { error: r.error } : ok("Request cancelled and the requester was notified.");
}

export async function inviteDonorsAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("requester"))) return DENIED;
  const p = inviteSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc<number>("invite_donors", { p_id: p.data.id });
  if (r.error) return { error: r.error };
  return ok(r.data ? `Invited ${r.data} preliminary match${r.data === 1 ? "" : "es"}. Their identity stays private until they accept.` : "No further compatible, available donors are registered in this request's city. Check that the city is spelled the same way donors enter it.");
}

export async function reviewRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("admin"))) return DENIED;
  const p = reviewSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("review_request", { p_id: p.data.id, p_decision: p.data.decision, p_note: p.data.note ?? null, p_method: p.data.method ?? null });
  return r.error ? { error: r.error } : ok(p.data.decision === "approve" ? "Request approved; matching donors were notified." : "Request rejected; the requester was told why.");
}

export async function acceptRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("donor"))) return DENIED;
  const p = requestIdSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("accept_request", { p_request_id: p.data.request, p_share_contact: Boolean(p.data.share) });
  return r.error ? { error: r.error } : ok("Thank you! The requester was notified.");
}

export async function respondInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("donor"))) return DENIED;
  const action = fd.get("action") === "decline" ? "decline" : "accept";
  const p = offerSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("respond_to_invitation", { p_offer_id: p.data.offer, p_action: action, p_share_contact: Boolean(p.data.share) });
  return r.error ? { error: r.error } : ok(action === "accept" ? "Invitation accepted. Thank you!" : "Invitation declined.");
}

export async function withdrawOfferAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("donor"))) return DENIED;
  const p = offerSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("withdraw_offer", { p_offer_id: p.data.offer });
  return r.error ? { error: r.error } : ok("Offer withdrawn. Your contact details are no longer shared.");
}

export async function setConsentAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("donor"))) return DENIED;
  const p = consentSchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("set_contact_consent", { p_offer_id: p.data.offer, p_granted: p.data.granted });
  return r.error ? { error: r.error } : ok(p.data.granted ? "Contact sharing turned on for this request." : "Contact sharing turned off. The requester can no longer see your details here.");
}

export async function recordEligibilityAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("admin"))) return DENIED;
  const p = eligibilitySchema.safeParse(Object.fromEntries(fd)); if (!p.success) return bad(p);
  const r = await rpc("set_donor_eligibility", { p_user: p.data.user, p_status: p.data.status, p_source: p.data.source, p_note: p.data.note ?? null });
  return r.error ? { error: r.error } : ok("Blood-service decision recorded.");
}

export async function setSuspendedAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!(await guard("admin"))) return DENIED;
  const raw = Object.fromEntries(fd);
  const p = suspendSchema.safeParse({ ...raw, reason: raw.reason ?? raw.note }); if (!p.success) return bad(p); // dialogs post the free text as "note"
  const r = await rpc("set_user_suspended", { p_user: p.data.user, p_suspended: p.data.suspended, p_reason: p.data.reason ?? null });
  return r.error ? { error: r.error } : ok(p.data.suspended ? "Account suspended." : "Account restored.");
}
