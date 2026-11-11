import { Badge, type Tone } from "@/components/ui/badge";
import type { OfferStatus, RequestStatus } from "@/lib/types";

export const REQUEST_LABEL: Record<RequestStatus, string> = { pending_review: "Pending review", approved: "Approved", rejected: "Rejected", matched: "Matched", fulfilled: "Fulfilled", cancelled: "Cancelled" };
const REQUEST_TONE: Record<RequestStatus, Tone> = { pending_review: "urgent", approved: "open", rejected: "critical", matched: "matched", fulfilled: "fulfilled", cancelled: "neutral" };
export const STATUS_HELP: Record<RequestStatus, string> = {
  pending_review: "An administrator is verifying this request. Donors are not notified until it is approved.",
  approved: "Approved and visible to preliminarily matching donors. Waiting for a donor to accept.",
  rejected: "This request was not approved, so it was never shown to donors.",
  matched: "At least one donor has accepted. Coordinate with them, then mark the request fulfilled.",
  fulfilled: "This request is complete. Contact details are no longer shown.",
  cancelled: "This request was cancelled. Contact details are no longer shown.",
};
export const StatusBadge = ({ status }: { status: RequestStatus }) => <Badge tone={REQUEST_TONE[status]}>{REQUEST_LABEL[status]}</Badge>;

const OFFER_TONE: Record<OfferStatus, Tone> = { invited: "open", accepted: "fulfilled", declined: "neutral", withdrawn: "neutral" };
export const OfferBadge = ({ status }: { status: OfferStatus }) => <Badge tone={OFFER_TONE[status]} className="capitalize">{status}</Badge>;
