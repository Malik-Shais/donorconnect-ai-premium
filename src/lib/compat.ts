/** Preliminary red-cell blood-group compatibility reference. Informational only:
 *  a blood service or clinician always confirms real compatibility and donor eligibility. */
export const GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
export type Group = (typeof GROUPS)[number];

const CAN_GIVE: Record<Group, readonly Group[]> = {
  "O-": GROUPS,
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"],
};

export const canGiveTo = (donor: Group): readonly Group[] => CAN_GIVE[donor];
export const canReceiveFrom = (recipient: Group): Group[] => GROUPS.filter((d) => CAN_GIVE[d].includes(recipient));
