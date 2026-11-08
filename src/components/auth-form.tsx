"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Card } from "@/components/ui/card";
import { Field, FormAlert, Select, SubmitButton } from "@/components/forms";
import { forgotAction, loginAction, registerAction, resetPasswordAction } from "@/app/actions/auth";
import { GROUPS } from "@/lib/compat";

type Mode = "login" | "register" | "forgot" | "reset";
const TITLE: Record<Mode, string> = { login: "Welcome back", register: "Join DonorConnect", forgot: "Reset your password", reset: "Choose a new password" };
const ACTION = { login: loginAction, register: registerAction, forgot: forgotAction, reset: resetPasswordAction };

export function AuthForm({ mode, role = "donor", next, notice }: { mode: Mode; role?: "donor" | "requester"; next?: string; notice?: string }) {
  const [state, action] = useActionState(ACTION[mode], undefined);
  const [r, setR] = useState(role);
  const done = mode === "forgot" && state?.message;

  return (
    <Card className="mx-auto w-full max-w-md p-6 md:p-8">
      <h1 className="mb-5 text-3xl font-bold">{TITLE[mode]}</h1>
      {notice && <p role="status" className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">{notice}</p>}
      <form action={action} noValidate className="grid gap-4">
        {mode === "login" && next && <input type="hidden" name="next" value={next} />}
        {mode === "register" && (
          <>
            <Field id="role" label="I want to" state={state} hint="Donate blood (donor) or request blood (requester).">
              <Select id="role" name="role" value={r} onChange={(e) => setR(e.target.value as "donor" | "requester")}>
                <option value="donor">Donate blood (donor)</option><option value="requester">Request blood (requester)</option>
              </Select>
            </Field>
            <Field id="full_name" label="Full name" state={state} autoComplete="name" />
          </>
        )}
        {mode !== "reset" && <Field id="email" label="Email" type="email" state={state} autoComplete={mode === "login" ? "username" : "email"} />}
        {(mode === "login" || mode === "register" || mode === "reset") && (
          <Field id="password" label={mode === "reset" ? "New password" : "Password"} type="password" state={state}
            autoComplete={mode === "login" ? "current-password" : "new-password"} hint={mode === "login" ? undefined : "8+ characters with a letter and a number."} />
        )}
        {mode === "reset" && <Field id="confirm" label="Confirm new password" type="password" state={state} autoComplete="new-password" />}
        {mode === "register" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="city" label="City" state={state} autoComplete="address-level2" />
              <Field id="phone" label="Phone (optional)" type="tel" state={state} autoComplete="tel" hint="Shared only with your consent." />
            </div>
            {r === "donor" && (
              <Field id="blood_group" label="Blood group" state={state} hint="Self-reported; a lab confirms the real group.">
                <Select id="blood_group" name="blood_group" defaultValue={state?.values?.blood_group ?? ""} aria-invalid={!!state?.fields?.blood_group}>
                  <option value="" disabled>Select…</option>{GROUPS.map((g) => <option key={g}>{g}</option>)}
                </Select>
              </Field>
            )}
            <div>
              <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" name="terms" className="mt-0.5 size-5 accent-burgundy" />
                I am 18 or older and understand this tool gives no medical advice.</label>
              {state?.fields?.terms && <p role="alert" className="pt-1 text-sm text-red-700">{state.fields.terms}</p>}
            </div>
          </>
        )}
        <FormAlert state={state} />
        {!done && <SubmitButton>{{ login: "Sign in", register: "Create account", forgot: "Send reset link", reset: "Update password" }[mode]}</SubmitButton>}
      </form>
      <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {mode === "login" && <><Link className="font-semibold text-teal underline" href="/register">Create an account</Link><Link className="font-semibold text-teal underline" href="/forgot-password">Forgot password?</Link></>}
        {mode === "register" && <>Already registered? <Link className="font-semibold text-teal underline" href="/login">Sign in</Link></>}
        {(mode === "forgot" || mode === "reset") && <Link className="font-semibold text-teal underline" href="/login">Back to sign in</Link>}
      </p>
    </Card>
  );
}
