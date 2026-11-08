"use client";
import { useActionState } from "react";
import { Field, FormAlert, Select, SubmitButton } from "@/components/forms";
import { updateProfileAction } from "@/app/actions/profile";
import { createRequestAction } from "@/app/actions/requests";
import { GROUPS } from "@/lib/compat";
import type { DonorProfile, Profile } from "@/lib/types";

export function ProfileForm({ profile, donor }: { profile: Profile; donor: DonorProfile | null }) {
  const [state, action] = useActionState(updateProfileAction, undefined);
  return (
    <form action={action} noValidate className="grid gap-4">
      <Field id="full_name" label="Full name" defaultValue={profile.full_name} state={state} autoComplete="name" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="city" label="City" defaultValue={profile.city} state={state} />
        <Field id="phone" label="Phone" type="tel" defaultValue={profile.phone ?? ""} state={state} hint="Shared only when you consent to a specific request." />
      </div>
      {donor && (
        <>
          <Field id="blood_group" label="Blood group" state={state} hint="Self-reported; a lab confirms your real group.">
            <Select id="blood_group" name="blood_group" defaultValue={donor.blood_group}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</Select>
          </Field>
          <Field id="last_donation_date" label="Last donation (optional)" type="date" defaultValue={donor.last_donation_date ?? ""} state={state}
            max={new Date().toISOString().slice(0, 10)} hint="Self-reported. Your blood service, not this app, decides when you may donate." />
          <label className="flex items-center gap-3 text-sm font-semibold text-navy">
            <input type="checkbox" name="available" defaultChecked={donor.available} className="size-5 accent-burgundy" /> Available to be matched
          </label>
        </>
      )}
      <FormAlert state={state} />
      <SubmitButton className="w-fit">Save changes</SubmitButton>
    </form>
  );
}

export function RequestForm({ defaultCity }: { defaultCity: string }) {
  const [state, action] = useActionState(createRequestAction, undefined);
  return (
    <form action={action} noValidate className="grid gap-4">
      <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">Use initials or an alias for the patient. Never enter diagnoses or medical records.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="patient_label" label="Patient alias / initials" state={state} />
        <Field id="blood_group" label="Blood group needed" state={state}>
          <Select id="blood_group" name="blood_group" defaultValue={state?.values?.blood_group ?? "A+"}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</Select>
        </Field>
        <Field id="units" label="Units" type="number" min={1} max={10} defaultValue={state?.values?.units ?? "1"} state={state} />
        <Field id="urgency" label="Urgency" state={state}>
          <Select id="urgency" name="urgency" defaultValue={state?.values?.urgency ?? "urgent"}>
            <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="critical">Critical</option>
          </Select>
        </Field>
        <Field id="city" label="City" defaultValue={state?.values?.city ?? defaultCity} state={state} />
        <Field id="hospital" label="Hospital / blood bank" state={state} />
      </div>
      <Field id="needed_by" label="Needed by (optional)" type="date" state={state} min={new Date().toISOString().slice(0, 10)} />
      <Field id="note" label="Note for donors (optional)" state={state}>
        <textarea id="note" name="note" rows={3} maxLength={300} defaultValue={state?.values?.note} className="w-full rounded-xl border-[1.5px] border-line bg-white px-3.5 py-2.5" />
      </Field>
      <FormAlert state={state} />
      <SubmitButton className="w-fit">Post request</SubmitButton>
    </form>
  );
}
