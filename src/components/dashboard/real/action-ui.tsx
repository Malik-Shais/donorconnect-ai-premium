"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { FormAlert, SubmitButton } from "@/components/forms";
import type { FormState } from "@/lib/validation";

type Act = (prev: FormState, fd: FormData) => Promise<FormState>;
const Hidden = ({ fields }: { fields: Record<string, string | number> }) => <>{Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;

/** A small inline form: hidden fields + optional extra controls (children) + one submit button + live feedback. */
export function InlineAction({ action, fields, label, variant, size = "sm", children, className }: {
  action: Act; fields: Record<string, string | number>; label: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; children?: React.ReactNode; className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "grid gap-2"}>
      <Hidden fields={fields} />
      {children}
      <div className="flex flex-wrap items-center gap-2"><SubmitButton size={size} variant={variant}>{label}</SubmitButton></div>
      <FormAlert state={state} />
    </form>
  );
}

/** Confirmation dialog (Radix: focus trap, Esc to close, labelled). Closes on success; shows server errors inline. */
export function ActionDialog({ action, fields, trigger, title, description, confirm, variant = "default", triggerVariant = "outline", noteLabel, noteRequired, children }: {
  action: Act; fields: Record<string, string | number>; trigger: string; title: string; description: string; confirm: string;
  variant?: ButtonProps["variant"]; triggerVariant?: ButtonProps["variant"]; noteLabel?: string; noteRequired?: boolean; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, undefined);
  const seen = useRef(state);
  useEffect(() => { if (state !== seen.current && state?.message) setOpen(false); seen.current = state; }, [state]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><Button size="sm" variant={triggerVariant}>{trigger}</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/50 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-1 flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-xl font-bold text-navy">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="grid size-9 place-items-center rounded-full hover:bg-navy/5"><X className="size-4" /></Dialog.Close>
          </div>
          <Dialog.Description className="mb-4 text-sm text-muted">{description}</Dialog.Description>
          <form action={formAction} className="grid gap-3">
            <Hidden fields={fields} />
            {children}
            {noteLabel && (
              <label className="grid gap-1.5 text-sm font-semibold text-navy">{noteLabel}{noteRequired ? " (required)" : " (optional)"}
                <textarea name="note" rows={3} maxLength={500} required={noteRequired} className="rounded-xl border-[1.5px] border-line bg-white px-3 py-2 font-normal text-ink" />
              </label>
            )}
            {state?.fields && Object.values(state.fields).map((m) => <p key={m} role="alert" className="text-sm text-red-700">{m}</p>)}
            {state?.error && !state.fields && <FormAlert state={state} />}
            <div className="mt-1 flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="ghost" size="sm">Back</Button></Dialog.Close>
              <SubmitButton size="sm" variant={variant}>{confirm}</SubmitButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
