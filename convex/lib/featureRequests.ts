/* Feature request board: statuses, categories and text helpers shared by the
   Convex functions and the UI (imported through the @convex alias). */

export const FEATURE_STATUSES = [
  "pending",
  "in_the_works",
  "beta",
  "q1",
  "q2",
  "q3",
  "q4",
  "shipped",
  "declined",
] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  pending: "Pending",
  in_the_works: "In the works",
  beta: "Beta",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
  shipped: "Shipped",
  declined: "Declined",
};

export const FEATURE_CATEGORIES = [
  "Booking",
  "Calendar",
  "Payments",
  "Music",
  "Marketing",
  "Team",
  "iOS app",
  "Other",
] as const;

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
/** Submissions allowed per person per rolling day. */
export const DAILY_SUBMIT_LIMIT = 10;

const STOP = new Set([
  "a", "an", "the", "to", "for", "of", "and", "or", "in", "on", "with", "my", "our",
  "we", "i", "it", "be", "is", "add", "can", "please", "ability", "option", "support",
]);

/** Lowercased content words of a title, for the duplicate matcher. */
export function titleWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** 0..1 word overlap between what is being typed and an existing title. The
 *  last typed word also matches by prefix, since it is usually unfinished. */
export function overlapScore(typed: string, existing: string): number {
  const a = titleWords(typed);
  if (a.length === 0) return 0;
  const b = titleWords(existing);
  if (b.length === 0) return 0;
  let hits = 0;
  a.forEach((w, i) => {
    const last = i === a.length - 1;
    if (b.some((x) => x === w || (last && w.length >= 3 && x.startsWith(w)))) hits += 1;
  });
  return hits / a.length;
}
