import type { Role } from "@/lib/nav";
import type { Group } from "@/lib/compat";

export type Profile = { id: string; role: Role; full_name: string; city: string; phone: string | null };
export type DonorProfile = { user_id: string; blood_group: Group; available: boolean; last_donation_date: string | null; eligibility_status: "unverified" | "cleared" | "deferred"; eligibility_note: string | null };
export type BloodRequest = { id: number; patient_label: string; blood_group: Group; units: number; city: string; hospital: string; urgency: "routine" | "urgent" | "critical"; needed_by: string | null; note: string | null; status: "open" | "matched" | "fulfilled" | "cancelled"; created_at: string };
export type Notification = { id: number; message: string; link: string | null; is_read: boolean; created_at: string };
export type Session = { email: string; profile: Profile; donor: DonorProfile | null };
