/* The four per-studio booking switches (orgs.bookingFeatures), in one place so
   the studio settings card, the agency table and the activity log all use the
   same words. All off by default; every plan gets them (decision 2026-10-14). */

export type BookingFeatureKey = "hidePricing" | "requireApproval" | "roomBlocks" | "changeApproval";

export const BOOKING_FEATURE_KEYS: readonly BookingFeatureKey[] = [
  "hidePricing",
  "requireApproval",
  "roomBlocks",
  "changeApproval",
];

export const BOOKING_FEATURE_COPY: Record<
  BookingFeatureKey,
  { label: string; short: string; blurb: string }
> = {
  hidePricing: {
    label: "Hide prices on the booking link",
    short: "Hide prices",
    blurb: "Clients send a request. No prices or payment on the public page.",
  },
  requireApproval: {
    label: "Require approval",
    short: "Approval",
    blurb: "New bookings from the link wait for an owner or manager to approve.",
  },
  roomBlocks: {
    label: "Room blocks",
    short: "Room blocks",
    blurb: "Block a room by day, week or month.",
  },
  changeApproval: {
    label: "Approve changes",
    short: "Approve changes",
    blurb: "Changing someone else's booking needs their OK.",
  },
};
