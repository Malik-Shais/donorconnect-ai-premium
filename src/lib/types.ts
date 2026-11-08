import type { Role } from "@/lib/nav";
import type { Group } from "@/lib/compat";

export type RequestStatus = "pending_review" | "approved" | "rejected" | "matched" | "fulfilled" | "cancelled";
export type OfferStatus = "invited" | "accepted" | "declined" | "withdrawn";
export type Profile = { id: string; role: Role; full_name: string; city: string; phone: string | null; suspended: boolean };
export type DonorProfile = { user_id: string; blood_group: Group; available: boolean; last_donation_date: string | null; eligibility_status: "unverified" | "cleared" | "deferred"; eligibility_note: string | null; notify_new_requests: boolean };
export type BloodRequest = { id: number; patient_label: string; blood_group: Group; units: number; city: string; hospital: string; urgency: "routine" | "urgent" | "critical"; needed_by: string | null; note: string | null; status: RequestStatus; created_at: string; review_note: string | null; verification_method: string | null; reviewed_at: string | null };
export type RequestEvent = { status: RequestStatus; note: string | null; created_at: string };
export type Notification = { id: number; message: string; link: string | null; is_read: boolean; created_at: string };
export type Session = { email: string; profile: Profile; donor: DonorProfile | null };
export type OwnerOffer = { offer_id: number; origin: string; status: OfferStatus; blood_group: Group; donor_city: string; contact_shared: boolean; donor_name: string | null; phone: string | null; email: string | null };
export type MyOffer = { offer_id: number; request_id: number; origin: string; status: OfferStatus; consent_granted: boolean; created_at: string; blood_group: Group; units: number; city: string; hospital: string; urgency: BloodRequest["urgency"]; needed_by: string | null; request_status: RequestStatus };
export type OpenReq = { id: number; blood_group: Group; units: number; city: string; hospital: string; urgency: BloodRequest["urgency"]; needed_by: string | null; status: RequestStatus; created_at: string; city_match: boolean; offer_id: number | null; offer_status: OfferStatus | null };
