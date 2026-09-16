export const EXPENSE_CATEGORIES = [
  { value: "rent", label: "Rent", taxGroup: "Rent or lease" },
  { value: "utilities", label: "Utilities", taxGroup: "Utilities" },
  { value: "software", label: "Software purchases", taxGroup: "Other expenses" },
  { value: "subscriptions", label: "Subscriptions", taxGroup: "Other expenses" },
  { value: "gear", label: "Gear and equipment", taxGroup: "Assets and depreciation review" },
  { value: "equipment_rental", label: "Equipment rental", taxGroup: "Rent or lease" },
  { value: "repairs", label: "Repairs and maintenance", taxGroup: "Repairs and maintenance" },
  { value: "payroll", label: "Payroll", taxGroup: "Wages" },
  { value: "contractor", label: "Contractor / engineer payout", taxGroup: "Contract labor" },
  { value: "production_services", label: "Production services", taxGroup: "Contract labor" },
  { value: "marketing", label: "Marketing and advertising", taxGroup: "Advertising" },
  { value: "events_showcases", label: "Events and showcases", taxGroup: "Other expenses" },
  { value: "team_meals", label: "Team meals", taxGroup: "Meals" },
  { value: "client_hospitality", label: "Client hospitality", taxGroup: "Meals" },
  { value: "supplies", label: "Studio and office supplies", taxGroup: "Office expense and supplies" },
  { value: "cleaning_security", label: "Cleaning and security", taxGroup: "Other expenses" },
  { value: "professional_services", label: "Legal and professional services", taxGroup: "Legal and professional services" },
  { value: "education_training", label: "Education and training", taxGroup: "Other expenses" },
  { value: "taxes_licenses", label: "Taxes, permits, and licenses", taxGroup: "Taxes and licenses" },
  { value: "music_licensing", label: "Music, samples, and licensing", taxGroup: "Other expenses" },
  { value: "insurance", label: "Insurance", taxGroup: "Insurance" },
  { value: "travel", label: "Travel and transportation", taxGroup: "Travel and vehicle review" },
  { value: "fees", label: "Bank and processing fees", taxGroup: "Commissions and fees" },
  { value: "adjustment", label: "P&L adjustment", taxGroup: "Accountant review" },
  { value: "other", label: "Other", taxGroup: "Other expenses" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export const INCOME_CATEGORIES = [
  { value: "recording_sessions", label: "Recording sessions" },
  { value: "mixing_mastering", label: "Mixing and mastering" },
  { value: "production", label: "Production services" },
  { value: "rehearsals", label: "Rehearsals" },
  { value: "memberships", label: "Memberships" },
  { value: "packages_prepaid", label: "Prepaid packages" },
  { value: "events", label: "Events and showcases" },
  { value: "licensing_royalties", label: "Licensing and royalties" },
  { value: "equipment_rental", label: "Equipment rental" },
  { value: "merchandise", label: "Merchandise" },
  { value: "other_income", label: "Other income" },
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]["value"];

export const MONEY_IN_KINDS = [
  { value: "income", label: "Business income", countsAsRevenue: true },
  { value: "stripe_payout", label: "Stripe payout", countsAsRevenue: false },
  { value: "recorded_payment", label: "Already recorded payment", countsAsRevenue: false },
  { value: "internal_transfer", label: "Transfer between accounts", countsAsRevenue: false },
  { value: "owner_contribution", label: "Owner contribution", countsAsRevenue: false },
  { value: "loan_proceeds", label: "Loan proceeds", countsAsRevenue: false },
  { value: "refund_reimbursement", label: "Refund or reimbursement", countsAsRevenue: false },
  { value: "other_non_income", label: "Other non-income", countsAsRevenue: false },
] as const;

export type MoneyInKind = (typeof MONEY_IN_KINDS)[number]["value"];

export const EXPENSE_CATEGORY_LABEL = new Map<string, string>(EXPENSE_CATEGORIES.map((category) => [category.value, category.label]));
export const EXPENSE_TAX_GROUP = new Map<string, string>(EXPENSE_CATEGORIES.map((category) => [category.value, category.taxGroup]));
export const INCOME_CATEGORY_LABEL = new Map<string, string>(INCOME_CATEGORIES.map((category) => [category.value, category.label]));
export const MONEY_IN_KIND_LABEL = new Map<string, string>(MONEY_IN_KINDS.map((kind) => [kind.value, kind.label]));
