import {
  ALLOWANCES,
  PRICING,
  TIERS,
  TIER_ROLES,
  UNLIMITED,
  UNMETERED,
  formatUsd,
  type TierKey,
} from "@convex/lib/pricing";
import { annualSavingCents, ANNUAL_MONTHS_FREE } from "@convex/lib/plans";

/* ============================================================
   Plan facts in display form, shared by /pricing (public) and /mypulse
   (internal). Every value is read from convex/lib/pricing.ts, so the two
   pages can never quote different numbers. Plain module: safe in server
   and client components alike.
   ============================================================ */

export type FactRow = { label: string; values: Record<TierKey, string> };

const byTier = (fn: (t: TierKey) => string): Record<TierKey, string> =>
  Object.fromEntries(TIERS.map((t) => [t, fn(t)])) as Record<TierKey, string>;

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  engineer: "Engineer",
  staff: "Staff",
  guest: "Guest",
};

/** "Unlimited" for the sentinel, otherwise a grouped number. */
export function countLabel(n: number): string {
  return n >= UNLIMITED ? "Unlimited" : n.toLocaleString("en-US");
}

/** "10 GB", "1,000 GB". */
export function storageLabel(gb: number): string {
  return `${gb.toLocaleString("en-US")} GB`;
}

/** Monthly and annual price per tier, plus what annual saves. */
export function priceRows(): FactRow[] {
  return [
    { label: "Monthly", values: byTier((t) => `${formatUsd(PRICING[t].monthlyCents)} a month`) },
    { label: "Annual", values: byTier((t) => `${formatUsd(PRICING[t].annualCents)} a year`) },
    {
      label: "Annual saves",
      values: byTier(
        (t) => `${formatUsd(annualSavingCents(t))} (${ANNUAL_MONTHS_FREE} months free)`,
      ),
    },
  ];
}

/** Roles, rooms, studios and allowances per tier. */
export function accessRows(): FactRow[] {
  return [
    {
      label: "Studios",
      values: byTier((t) =>
        PRICING[t].unlimitedStudios || ALLOWANCES[t].studios >= UNLIMITED
          ? "Unlimited, one flat price"
          : countLabel(ALLOWANCES[t].studios),
      ),
    },
    {
      label: "Rooms",
      values: byTier((t) => {
        const a = ALLOWANCES[t];
        if (a.rooms < UNLIMITED) return `Up to ${a.rooms}`;
        return a.studios >= UNLIMITED ? "Unlimited" : "Unlimited at one location";
      }),
    },
    {
      label: "Roles",
      values: byTier((t) => TIER_ROLES[t].map((r) => ROLE_LABEL[r] ?? r).join(", ")),
    },
    { label: "Team logins", values: byTier((t) => countLabel(ALLOWANCES[t].staff)) },
    {
      label: "Team invites a month",
      values: byTier((t) => countLabel(ALLOWANCES[t].inviteLinksPerMonth)),
    },
    {
      label: "Assistant credits a month",
      values: byTier((t) => countLabel(ALLOWANCES[t].assistantPerMonth)),
    },
    { label: "File storage", values: byTier((t) => storageLabel(ALLOWANCES[t].storageGb)) },
    {
      label: UNMETERED.length === 2 ? "Texts and email" : "Messages",
      values: byTier(() => "Not capped"),
    },
  ];
}

/** True for any tier whose allowances are shared across all its studios. */
export function pooledTiers(): TierKey[] {
  return TIERS.filter((t) => ALLOWANCES[t].pooled);
}
