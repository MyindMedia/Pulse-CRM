import { v } from "convex/values";

export const expenseCategoryV = v.union(
  v.literal("rent"),
  v.literal("utilities"),
  v.literal("software"),
  v.literal("subscriptions"),
  v.literal("gear"),
  v.literal("equipment_rental"),
  v.literal("repairs"),
  v.literal("payroll"),
  v.literal("contractor"),
  v.literal("production_services"),
  v.literal("marketing"),
  v.literal("events_showcases"),
  v.literal("team_meals"),
  v.literal("client_hospitality"),
  v.literal("supplies"),
  v.literal("cleaning_security"),
  v.literal("professional_services"),
  v.literal("education_training"),
  v.literal("taxes_licenses"),
  v.literal("music_licensing"),
  v.literal("insurance"),
  v.literal("travel"),
  v.literal("fees"),
  v.literal("adjustment"),
  v.literal("other"),
);

export const incomeCategoryV = v.union(
  v.literal("recording_sessions"),
  v.literal("mixing_mastering"),
  v.literal("production"),
  v.literal("rehearsals"),
  v.literal("memberships"),
  v.literal("packages_prepaid"),
  v.literal("events"),
  v.literal("licensing_royalties"),
  v.literal("equipment_rental"),
  v.literal("merchandise"),
  v.literal("other_income"),
);

export const moneyInKindV = v.union(
  v.literal("income"),
  v.literal("stripe_payout"),
  v.literal("recorded_payment"),
  v.literal("internal_transfer"),
  v.literal("owner_contribution"),
  v.literal("loan_proceeds"),
  v.literal("refund_reimbursement"),
  v.literal("other_non_income"),
);
