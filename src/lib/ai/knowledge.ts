import type { Role } from "@/lib/nav";

/** Static, reviewed help content. Used by the get_platform_help tool AND the no-AI "quick answers" panel. */
export const HELP: Record<Role, Record<string, { title: string; body: string }>> = {
  donor: {
    start: { title: "Getting started as a donor", body: "Set your availability and profile (Profile page). Approved requests that preliminarily match your blood group appear under Opportunities, ranked by your city and urgency. You choose whether to accept, and whether to share your contact details for each accepted request." },
    matching: { title: "How matching works", body: "Matching uses a preliminary ABO/Rh red-cell compatibility guide plus city and availability. It is educational only: blood services and clinicians confirm real compatibility and decide who may donate." },
    consent: { title: "Contact sharing and consent", body: "Your name, phone and email are hidden by default. If you accept a request and tick the consent box, the requester can see them only while that request is active. You can turn sharing off any time in My offers; details already seen or copied cannot be recalled." },
    eligibility: { title: "Eligibility", body: "Eligibility is decided by your blood service or a clinician, never by this app or the assistant. If a decision is recorded, it appears on your dashboard." },
    status: { title: "Request statuses", body: "pending_review: an administrator is verifying it. approved: visible to matching donors. matched: at least one donor accepted. fulfilled: completed. rejected or cancelled: closed." },
  },
  requester: {
    start: { title: "Submitting a request", body: "Use New request (3 steps). Use an alias or initials for the patient, never medical records. An administrator verifies it before any donor is notified." },
    status: { title: "Request statuses", body: "pending_review: waiting for an administrator. approved: matching donors can see it. matched: a donor accepted. fulfilled/cancelled/rejected: closed. You can cancel at any time before it is fulfilled." },
    consent: { title: "Donor contact details", body: "Donors are anonymous until they accept. A donor's name, phone and email appear on your request page only if that donor consented, and only while the request is active. The assistant never reveals contact details." },
    invite: { title: "Inviting donors", body: "On an approved request, use Invite matching donors. Up to 20 preliminary matches are invited without revealing who they are." },
  },
  admin: {
    start: { title: "Admin overview", body: "Review queue: verify each request (method + attestation) then approve or reject with a reason. Requests, Users and Eligibility pages support moderation and recording of blood-service decisions." },
    review: { title: "Reviewing requests", body: "Approve only after verifying the request (hospital call, document, or known requester). Approval notifies same-city compatible donors. Rejection requires a reason shown to the requester. All decisions are audited." },
    eligibility: { title: "Eligibility recording", body: "Administrators only record decisions communicated by an authorised blood service, naming the source. They never medically clear a donor." },
    moderation: { title: "Moderation", body: "Cancel a request with a note, or suspend an account with a reason. Administrators never see donor contact details." },
  },
};
export const TOPICS = (role: Role) => Object.keys(HELP[role]);

export const SUGGESTIONS: Record<Role, string[]> = {
  donor: ["How does matching work?", "What do my request statuses mean?", "Show my matching opportunities", "How is my contact information protected?"],
  requester: ["How do I submit a request?", "Where are my requests right now?", "How does donor contact sharing work?", "What does 'pending review' mean?"],
  admin: ["How do I review a request?", "Summarize the current operational numbers", "What can I record about donor eligibility?", "How does moderation work?"],
};
