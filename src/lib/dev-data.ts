/** FICTIONAL development data. Replaced by Supabase queries in the data stage. */
import type { Group } from "./compat";
import type { Tone } from "@/components/ui/badge";

export type DevRequest = { id: number; group: Group; units: number; hospital: string; city: string; urgency: "routine" | "urgent" | "critical"; status: "open" | "matched" | "fulfilled"; ago: string };

export const devRequests: DevRequest[] = [
  { id: 1, group: "A+", units: 2, hospital: "Demo City Hospital", city: "Karachi", urgency: "urgent", status: "open", ago: "2h ago" },
  { id: 2, group: "O-", units: 1, hospital: "Sample General Hospital", city: "Lahore", urgency: "critical", status: "open", ago: "5h ago" },
  { id: 3, group: "B+", units: 3, hospital: "Example Medical Centre", city: "Islamabad", urgency: "routine", status: "matched", ago: "1d ago" },
  { id: 4, group: "O+", units: 2, hospital: "Demo City Hospital", city: "Karachi", urgency: "urgent", status: "fulfilled", ago: "3d ago" },
];

export const urgencyTone: Record<DevRequest["urgency"], Tone> = { routine: "neutral", urgent: "urgent", critical: "critical" };
export const statusTone: Record<DevRequest["status"], Tone> = { open: "open", matched: "matched", fulfilled: "fulfilled" };

export const devPerDay = [3, 5, 2, 6, 4, 7, 5, 8, 6, 4, 9, 7, 6, 10].map((n, i) => ({ day: `D${i + 1}`, requests: n }));
export const devSupplyDemand = (["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as Group[]).map((g, i) => ({
  group: g, donors: [12, 30, 9, 26, 7, 18, 4, 10][i], units: [5, 7, 2, 9, 3, 6, 1, 2][i],
}));
export const devNotifications = [
  { id: 1, text: "Urgent A+ request at Demo City Hospital, Karachi", ago: "2h ago" },
  { id: 2, text: "Welcome to DonorConnect AI. Complete your profile.", ago: "1d ago" },
];
