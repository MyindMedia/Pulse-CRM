/* ============================================================
   Display maps - one source of truth for how every enum value
   reads and which Badge tone it carries. Keeps modules consistent.
   ============================================================ */

type Tone = "neutral" | "gold" | "positive" | "caution" | "critical" | "info" | "solid";
type Meta = { label: string; tone: Tone };

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SONG_STAGE: Record<string, Meta> = {
  writing: { label: "Writing", tone: "neutral" },
  demo: { label: "Demo", tone: "info" },
  tracking: { label: "Tracking", tone: "info" },
  editing: { label: "Editing", tone: "caution" },
  mixing: { label: "Mixing", tone: "caution" },
  mastering: { label: "Mastering", tone: "gold" },
  delivered: { label: "Delivered", tone: "positive" },
  released: { label: "Released", tone: "solid" },
};

export const SESSION_STATUS: Record<string, Meta> = {
  tentative: { label: "Tentative", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "info" },
  in_progress: { label: "In progress", tone: "gold" },
  completed: { label: "Completed", tone: "positive" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No-show", tone: "critical" },
};

export const INVOICE_STATUS: Record<string, Meta> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  viewed: { label: "Viewed", tone: "info" },
  paid: { label: "Paid", tone: "positive" },
  overdue: { label: "Overdue", tone: "critical" },
  void: { label: "Void", tone: "neutral" },
};

/** How an invoice was settled - manual methods, the online card path, and
 * the bucket for invoices paid before the field existed. */
export const PAYMENT_METHOD: Record<string, Meta> = {
  venmo: { label: "Venmo", tone: "info" },
  cash: { label: "Cash", tone: "positive" },
  cashapp: { label: "Cash App", tone: "positive" },
  zelle: { label: "Zelle", tone: "info" },
  credit: { label: "Studio credit", tone: "gold" },
  card: { label: "Card (online)", tone: "info" },
  unrecorded: { label: "Unrecorded", tone: "neutral" },
};

export const PIPELINE_STAGE: Record<string, Meta> = {
  inquiry: { label: "Inquiry", tone: "neutral" },
  qualified: { label: "Qualified", tone: "info" },
  proposal: { label: "Proposal", tone: "info" },
  booked: { label: "Booked", tone: "gold" },
  in_progress: { label: "In progress", tone: "gold" },
  delivered: { label: "Delivered", tone: "positive" },
  won: { label: "Won", tone: "positive" },
  lost: { label: "Lost", tone: "critical" },
};

export const ARTIST_STATUS: Record<string, Meta> = {
  lead: { label: "Lead", tone: "info" },
  active: { label: "Active", tone: "positive" },
  dormant: { label: "Dormant", tone: "caution" },
  vip: { label: "VIP", tone: "solid" },
};

export const RELIABILITY: Record<string, Meta> = {
  solid: { label: "Solid", tone: "positive" },
  watch: { label: "Watch", tone: "caution" },
  flagged: { label: "Flagged", tone: "critical" },
};

export const SYNC_STAGE: Record<string, Meta> = {
  pitched: { label: "Pitched", tone: "neutral" },
  heard: { label: "Heard", tone: "info" },
  shortlisted: { label: "Shortlisted", tone: "gold" },
  negotiating: { label: "Negotiating", tone: "caution" },
  placed: { label: "Placed", tone: "positive" },
  passed: { label: "Passed", tone: "critical" },
};

export const LICENSE_TIER: Record<string, Meta> = {
  mp3: { label: "MP3 Lease", tone: "neutral" },
  wav: { label: "WAV Lease", tone: "info" },
  trackout: { label: "Trackout", tone: "gold" },
  exclusive: { label: "Exclusive", tone: "solid" },
};

export const CAMPAIGN_STATUS: Record<string, Meta> = {
  planning: { label: "Planning", tone: "neutral" },
  active: { label: "Active", tone: "gold" },
  released: { label: "Released", tone: "positive" },
};

export const SPEC_STATUS: Record<string, Meta> = {
  idea: { label: "Idea", tone: "neutral" },
  demo: { label: "Demo", tone: "info" },
  shopped: { label: "Shopped", tone: "caution" },
  pitched: { label: "Pitched", tone: "gold" },
  picked_up: { label: "Picked up", tone: "positive" },
  shelved: { label: "Shelved", tone: "neutral" },
};

/** Activity-feed accent → Badge tone. */
export const ACCENT_TONE: Record<string, Tone> = {
  gold: "gold",
  positive: "positive",
  critical: "critical",
  info: "info",
};

/** Safe lookup - falls back to a title-cased neutral badge. */
export function meta(map: Record<string, Meta>, key?: string): Meta {
  if (!key) return { label: "-", tone: "neutral" };
  return map[key] ?? { label: titleCase(key), tone: "neutral" };
}

export { titleCase };
