"use client";
import { useActionState, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Field, FormAlert, Select, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { createRequestAction } from "@/app/actions/requests";
import { GROUPS } from "@/lib/compat";
import { requestSchema } from "@/lib/validation";

const STEPS = ["Patient & blood", "Where & when", "Review"] as const;
const STEP_FIELDS = [["patient_label", "blood_group", "units", "urgency"], ["city", "hospital", "needed_by", "note"], []] as const;
const LABELS: Record<string, string> = { patient_label: "Patient alias", blood_group: "Blood group", units: "Units", urgency: "Urgency", city: "City", hospital: "Hospital / blood bank", needed_by: "Needed by", note: "Note" };

/** Three steps in one <form>: inactive steps are only hidden, so every value is submitted natively and nothing is lost on Back. */
export function RequestWizard({ defaultCity }: { defaultCity: string }) {
  const [state, action] = useActionState(createRequestAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Record<string, string>>({});
  const merged = { fields: { ...state?.fields, ...errors }, values: state?.values };
  const read = () => Object.fromEntries(new FormData(form.current!)) as Record<string, string>;

  function next() {
    const vals = read(), keys = STEP_FIELDS[step] as readonly string[];
    const r = requestSchema.safeParse(vals);
    const own = r.success ? [] : r.error.issues.filter((i) => keys.includes(String(i.path[0])));
    setErrors(Object.fromEntries(own.map((i) => [String(i.path[0]), i.message])));
    if (own.length) return;
    setSummary(vals); setStep(step + 1);
    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[data-step="${step + 1}"] input, [data-step="${step + 1}"] select, [data-step="${step + 1}"] button`)?.focus());
  }

  return (
    <form ref={form} action={action} noValidate className="grid min-w-0 gap-5">
      <ol aria-label="Progress" className="flex min-w-0 gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold sm:text-sm ${i === step ? "border-burgundy bg-burgundy/5 text-burgundy" : i < step ? "border-teal/40 bg-teal-soft text-teal-900" : "border-line text-muted"}`}>
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-current/15 text-[0.7rem]">{i < step ? <Check className="size-3" aria-hidden /> : i + 1}</span><span className={i === step ? "truncate" : "sr-only sm:not-sr-only sm:truncate"}>{s}</span>
          </li>
        ))}
      </ol>
      <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">Use initials or an alias for the patient. Never enter diagnoses or medical records. An administrator verifies every request before any donor is notified.</p>

      <fieldset hidden={step !== 0} data-step={0} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="sr-only">Patient and blood</legend>
        <Field id="patient_label" label="Patient alias / initials" state={merged} />
        <Field id="blood_group" label="Blood group needed" state={merged}><Select id="blood_group" name="blood_group" defaultValue={state?.values?.blood_group ?? "A+"}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
        <Field id="units" label="Units" type="number" min={1} max={10} defaultValue={state?.values?.units ?? "1"} state={merged} />
        <Field id="urgency" label="Urgency" state={merged}><Select id="urgency" name="urgency" defaultValue={state?.values?.urgency ?? "urgent"}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="critical">Critical</option></Select></Field>
      </fieldset>
      <fieldset hidden={step !== 1} data-step={1} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="sr-only">Location and timing</legend>
        <Field id="city" label="City" defaultValue={state?.values?.city ?? defaultCity} state={merged} />
        <Field id="hospital" label="Hospital / blood bank" state={merged} />
        <Field id="needed_by" label="Needed by (optional)" type="date" min={new Date().toISOString().slice(0, 10)} state={merged} className="sm:col-span-2" />
        <Field id="note" label="Note for donors (optional)" state={merged} className="sm:col-span-2"><textarea id="note" name="note" rows={3} maxLength={300} defaultValue={state?.values?.note} className="w-full rounded-xl border-[1.5px] border-line bg-white px-3.5 py-2.5" /></Field>
      </fieldset>
      <div hidden={step !== 2} data-step={2} className="grid gap-3">
        <h2 className="font-display text-xl font-bold">Check your request</h2>
        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line p-4 text-sm sm:grid-cols-2">
          {Object.keys(LABELS).map((k) => <div key={k}><dt className="text-xs text-muted">{LABELS[k]}</dt><dd className="font-semibold">{summary[k] || "-"}</dd></div>)}
        </dl>
        <p className="text-sm text-muted">After you submit, the request is <b>pending review</b>. You can cancel it at any time before a donor is matched.</p>
        {Object.keys(merged.fields).length > 0 && <p role="alert" className="text-sm text-red-700">Some details need fixing: {Object.values(merged.fields).join(" · ")}. Go back to edit them.</p>}
      </div>

      <FormAlert state={state?.fields ? undefined : state} />
      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="outline" disabled={step === 0} onClick={() => { setErrors({}); setStep(step - 1); }}><ArrowLeft aria-hidden /> Back</Button>
        {step < 2 ? <Button type="button" onClick={next}>Next <ArrowRight aria-hidden /></Button> : <SubmitButton>Submit for review</SubmitButton>}
      </div>
    </form>
  );
}
