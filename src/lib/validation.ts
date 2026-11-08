import { z } from "zod";
import { GROUPS } from "@/lib/compat";

const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`);
const phone = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^[0-9+()\-\s]{7,20}$/, "Enter a valid phone number").optional());
const optionalDate = z.preprocess((v) => (v === "" ? undefined : v), z.iso.date("Enter a valid date").optional());
const bloodGroup = z.enum(GROUPS, { error: "Choose a blood group" });
const password = z.string().min(8, "Use at least 8 characters").max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");
const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const notFuture = (d?: string) => !d || d <= new Date().toISOString().slice(0, 10);

export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password").max(128) });

export const registerSchema = z.object({
  role: z.enum(["donor", "requester"], { error: "Choose a valid account type" }), // 'admin' is never accepted here
  full_name: text(2, 60, "Name"),
  email, password,
  city: text(2, 60, "City"),
  phone,
  blood_group: z.preprocess((v) => (v === "" ? undefined : v), bloodGroup.optional()),
  terms: z.literal("on", { error: "Please confirm you are 18+ and accept the terms" }),
}).refine((v) => v.role !== "donor" || v.blood_group, { path: ["blood_group"], message: "Choose your blood group" });

export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export const profileSchema = z.object({
  full_name: text(2, 60, "Name"), city: text(2, 60, "City"), phone,
  blood_group: z.preprocess((v) => (v === "" || v == null ? undefined : v), bloodGroup.optional()),
  last_donation_date: optionalDate.refine(notFuture, "Last donation cannot be in the future"),
  available: z.preprocess((v) => v === "on", z.boolean()),
  notify_new_requests: z.preprocess((v) => v === "on", z.boolean()),
});

export const requestSchema = z.object({
  patient_label: text(2, 40, "Patient alias"),
  blood_group: bloodGroup,
  units: z.coerce.number({ error: "Enter the units needed" }).int().min(1, "At least 1 unit").max(10, "At most 10 units"),
  city: text(2, 60, "City"), hospital: text(2, 100, "Hospital"),
  urgency: z.enum(["routine", "urgent", "critical"], { error: "Choose urgency" }),
  needed_by: optionalDate,
  note: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(300, "Note is too long").optional()),
});

export const closeRequestSchema = z.object({ id: z.coerce.number().int().positive(), status: z.enum(["fulfilled", "cancelled"]) });

const optText = (max: number) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().trim().max(max, "That is too long").optional());
const id = z.coerce.number({ error: "Invalid request" }).int().positive();
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const transitionSchema = z.object({ id, to: z.enum(["cancelled", "fulfilled"]), note: optText(300) });
export const inviteSchema = z.object({ id });
export const reviewSchema = z.object({
  id, decision: z.enum(["approve", "reject"]),
  method: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["hospital_call", "hospital_document", "known_requester", "other"], { error: "Choose how it was verified" }).optional()),
  note: optText(500), verified: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.decision === "approve" && !v.method) ctx.addIssue({ code: "custom", path: ["method"], message: "Choose how the request was verified" });
  if (v.decision === "approve" && v.verified !== "on") ctx.addIssue({ code: "custom", path: ["verified"], message: "Confirm that you verified this request" });
  if (v.decision === "reject" && (v.note?.length ?? 0) < 5) ctx.addIssue({ code: "custom", path: ["note"], message: "Give the requester a reason (at least 5 characters)" });
});
export const offerSchema = z.object({ offer: id, share: z.preprocess((v) => v === "on", z.boolean()).optional() });
export const requestIdSchema = z.object({ request: id, share: z.preprocess((v) => v === "on", z.boolean()).optional() });
export const consentSchema = z.object({ offer: id, granted: bool });
export const eligibilitySchema = z.object({
  user: z.uuid(), status: z.enum(["unverified", "cleared", "deferred"], { error: "Choose a status" }),
  source: text(3, 120, "Source"), note: optText(300),
  attest: z.literal("on", { error: "Confirm this decision came from an authorised blood service" }),
});
export const suspendSchema = z.object({ user: z.uuid(), suspended: bool, reason: optText(300) });

export type FormState = { error?: string; message?: string; fields?: Record<string, string>; values?: Record<string, string> } | undefined;
export const fieldErrors = (e: z.ZodError): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0])] ??= i.message;
  return out;
};
