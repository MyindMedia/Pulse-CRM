import {
  AudioWaveform,
  Blocks,
  Library,
  Package,
  RefreshCw,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type SoftwareCategory =
  | "daw"
  | "plugin"
  | "sample_library"
  | "subscription"
  | "utility"
  | "other";

export type SoftwareLicenseType = "perpetual" | "subscription";
export type BillingInterval = "one_time" | "monthly" | "annual";
export type SoftwareStatus = "active" | "expired" | "unused";

type Tone = "neutral" | "gold" | "positive" | "caution" | "critical" | "info" | "solid";

export const SOFTWARE_CATEGORIES: {
  value: SoftwareCategory;
  label: string;
  plural: string;
  icon: LucideIcon;
}[] = [
  { value: "daw", label: "DAW", plural: "DAWs", icon: AudioWaveform },
  { value: "plugin", label: "Plugin", plural: "Plugins", icon: Blocks },
  { value: "sample_library", label: "Sample library", plural: "Sample libraries", icon: Library },
  { value: "subscription", label: "Subscription", plural: "Subscriptions", icon: RefreshCw },
  { value: "utility", label: "Utility", plural: "Utilities", icon: Wrench },
  { value: "other", label: "Other", plural: "Other", icon: Package },
];

const CAT_BY_VALUE = new Map(SOFTWARE_CATEGORIES.map((c) => [c.value, c]));
export function softwareCategoryMeta(category: string) {
  return (
    CAT_BY_VALUE.get(category as SoftwareCategory) ?? {
      value: category as SoftwareCategory,
      label: category,
      plural: category,
      icon: Package,
    }
  );
}

export const SOFTWARE_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "positive" },
  expired: { label: "Expired", tone: "critical" },
  unused: { label: "Unused", tone: "neutral" },
};

export const LICENSE_TYPES: { value: SoftwareLicenseType; label: string }[] = [
  { value: "perpetual", label: "Perpetual" },
  { value: "subscription", label: "Subscription" },
];

export const BILLING_INTERVALS: { value: BillingInterval; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

export const INTERVAL_SUFFIX: Record<string, string> = {
  one_time: "",
  monthly: "/mo",
  annual: "/yr",
};
