"use client";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

const login = z.object({ email: z.email("Enter a valid email address"), password: z.string().min(1, "Enter your password") });
const register = login.extend({
  name: z.string().trim().min(2, "Enter your full name").max(60),
  role: z.enum(["donor", "requester"]),
  password: z.string().min(8, "Use at least 8 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number"),
  terms: z.literal("on", { error: "Please confirm you are 18+ and accept the terms" }),
});

export function AuthForm({ mode, role = "donor" }: { mode: "login" | "register"; role?: "donor" | "requester" }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = (mode === "login" ? login : register).safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (parsed.success) { setErrors({}); setDone(true); return; }
    setDone(false);
    setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  }
  const field = (id: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-navy">{label}</label>
      <Input id={id} name={id} aria-invalid={!!errors[id]} aria-describedby={`${id}-err`} {...props} />
      <p id={`${id}-err`} className="min-h-5 pt-1 text-sm text-red-700" role="alert">{errors[id]}</p>
    </div>
  );

  return (
    <Card className="mx-auto w-full max-w-md p-6 md:p-8">
      <h1 className="mb-5 text-3xl font-bold">{mode === "login" ? "Welcome back" : "Join DonorConnect"}</h1>
      <form noValidate onSubmit={onSubmit} className="grid gap-1">
        {mode === "register" && (
          <>
            <div>
              <label htmlFor="role" className="mb-1.5 block text-sm font-semibold text-navy">I want to</label>
              <select id="role" name="role" defaultValue={role} className="min-h-11 w-full rounded-xl border-[1.5px] border-line bg-white px-3">
                <option value="donor">Donate blood (donor)</option><option value="requester">Request blood (requester)</option>
              </select><p className="min-h-5" />
            </div>
            {field("name", "Full name", { autoComplete: "name" })}
          </>
        )}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("password", "Password", { type: "password", autoComplete: mode === "login" ? "current-password" : "new-password" })}
        {mode === "register" && (
          <div className="mb-1">
            <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" name="terms" className="mt-0.5 size-5 accent-burgundy" /> I am 18 or older and understand this tool gives no medical advice.</label>
            <p className="min-h-5 pt-1 text-sm text-red-700" role="alert">{errors.terms}</p>
          </div>
        )}
        <Button type="submit" className="mt-1">{mode === "login" ? "Sign in" : "Create account"}</Button>
      </form>
      {done && (
        <p className="mt-4 rounded-xl bg-teal-soft p-3 text-sm text-teal-900" role="status">
          Form is valid. Supabase Auth is connected in the next stage; meanwhile <Link className="font-semibold underline" href="/dashboard/donor">open the preview dashboard</Link>.
        </p>
      )}
      <p className="mt-5 text-sm text-muted">
        {mode === "login" ? <>New here? <Link className="font-semibold text-teal underline" href="/register">Create an account</Link></> : <>Already registered? <Link className="font-semibold text-teal underline" href="/login">Sign in</Link></>}
      </p>
    </Card>
  );
}
