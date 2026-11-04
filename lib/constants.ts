/** Shared between server and browser code (no database imports here). */
export const LEAD_STATUSES = ["new", "contacted", "interested", "proposal", "won", "lost", "skip"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
