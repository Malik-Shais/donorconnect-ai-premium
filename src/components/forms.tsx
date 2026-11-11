"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export function SubmitButton({ children, ...p }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...p}>
      {pending && <Loader2 className="animate-spin" aria-hidden />} {children}
    </Button>
  );
}

export function FormAlert({ state }: { state: FormState }) {
  if (state?.error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{state.error}</p>;
  if (state?.message) return <p role="status" className="rounded-xl border border-teal/30 bg-teal-soft px-3.5 py-2.5 text-sm text-teal-900">{state.message}</p>;
  return null;
}

type FieldProps = { id: string; label: string; state?: FormState; hint?: string; children?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>;
/** Labelled input (or custom control via children) with accessible error wiring. */
export function Field({ id, label, state, hint, children, className, ...input }: FieldProps) {
  const err = state?.fields?.[id];
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-navy">{label}</label>
      {children ?? <Input id={id} name={id} defaultValue={state?.values?.[id]} aria-invalid={!!err} aria-describedby={`${id}-msg`} {...input} />}
      {hint && !err && <p id={`${id}-msg`} className="pt-1 text-xs text-muted">{hint}</p>}
      {err && <p id={`${id}-msg`} role="alert" className="pt-1 text-sm text-red-700">{err}</p>}
    </div>
  );
}

export const Select = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("min-h-11 w-full rounded-xl border-[1.5px] border-line bg-white px-3 text-ink focus:border-teal", className)} {...p} />
);
