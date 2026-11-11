import { describe, expect, it } from "vitest";
import { closeRequestSchema, loginSchema, profileSchema, registerSchema, requestSchema, resetSchema } from "./validation";
import { safeNext } from "./env";

const ok = { role: "donor", full_name: "Ayesha Khan", email: "A@X.com", password: "Passw0rd1", city: "Lahore", phone: "", blood_group: "O+", terms: "on" };

describe("registerSchema", () => {
  it("accepts a valid donor and normalises email/phone", () => {
    const r = registerSchema.parse(ok);
    expect(r.email).toBe("a@x.com"); expect(r.phone).toBeUndefined();
  });
  it("NEVER accepts an admin (or unknown) role", () => {
    expect(registerSchema.safeParse({ ...ok, role: "admin" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, role: "superuser" }).success).toBe(false);
  });
  it("requires blood group for donors only", () => {
    expect(registerSchema.safeParse({ ...ok, blood_group: "" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, role: "requester", blood_group: "" }).success).toBe(true);
  });
  it("rejects weak passwords, bad emails, missing terms and bad phones", () => {
    for (const bad of [{ password: "short1" }, { password: "allletters" }, { password: "12345678" }, { email: "nope" }, { terms: undefined }, { phone: "abc" }, { full_name: "A" }])
      expect(registerSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
});
describe("other schemas", () => {
  it("login requires both fields", () => expect(loginSchema.safeParse({ email: "a@x.com", password: "" }).success).toBe(false));
  it("reset requires matching passwords", () => {
    expect(resetSchema.safeParse({ password: "Passw0rd1", confirm: "Passw0rd2" }).success).toBe(false);
    expect(resetSchema.safeParse({ password: "Passw0rd1", confirm: "Passw0rd1" }).success).toBe(true);
  });
  it("profile: checkbox semantics and future-date rejection", () => {
    const base = { full_name: "Ayesha", city: "Lahore", phone: "", blood_group: "A+" };
    expect(profileSchema.parse({ ...base }).available).toBe(false);
    expect(profileSchema.parse({ ...base, available: "on" }).available).toBe(true);
    expect(profileSchema.safeParse({ ...base, last_donation_date: "2999-01-01" }).success).toBe(false);
  });
  it("request: bounds and urgency", () => {
    const base = { patient_label: "P.A", blood_group: "A+", units: "2", city: "Lahore", hospital: "Demo Hospital", urgency: "urgent" };
    expect(requestSchema.parse(base).units).toBe(2);
    for (const bad of [{ units: "0" }, { units: "11" }, { urgency: "now" }, { blood_group: "Z+" }]) expect(requestSchema.safeParse({ ...base, ...bad }).success).toBe(false);
  });
  it("closeRequest only allows fulfilled/cancelled", () => {
    expect(closeRequestSchema.safeParse({ id: "1", status: "matched" }).success).toBe(false);
    expect(closeRequestSchema.safeParse({ id: "1", status: "fulfilled" }).success).toBe(true);
  });
});
describe("safeNext (open-redirect guard)", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNext("/dashboard/donor")).toBe("/dashboard/donor");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", undefined, 5]) expect(safeNext(bad)).toBe("/dashboard");
  });
});
