"use client";
import { useActionState } from "react";
import { Field, FormAlert, Select, SubmitButton } from "@/components/forms";
import { updateProfileAction } from "@/app/actions/profile";
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
          <label className="flex items-center gap-3 text-sm font-semibold text-navy">
            <input type="checkbox" name="notify_new_requests" defaultChecked={donor.notify_new_requests} className="size-5 accent-burgundy" /> Notify me about new approved requests in my city
          </label>
        </>
      )}
      <FormAlert state={state} />
      <SubmitButton className="w-fit">Save changes</SubmitButton>
    </form>
  );
}

