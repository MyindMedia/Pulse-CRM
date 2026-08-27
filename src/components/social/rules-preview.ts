import type { Platform } from "@convex/lib/ghl";
// `rules.ts` imports only `import type { Platform }` from ghl.ts, which
// erases at compile - so validateForPlatform itself carries no server-only
// dependency and is safe to run in the browser for live warnings, the same
// checks the backend applies at save time (convex/marketing/posts.ts
// validateInput). This file exists so the per-account loop is one pure,
// testable function rather than logic buried inside composer.tsx.
import { validateForPlatform, captionLimit, type MediaKind } from "@convex/marketing/rules";

export type AccountWarning = {
  accountId: string;
  platform: Platform;
  problems: string[];
};

/** Live, client-side preview of the per-platform rules the backend enforces
 *  on save. Only accounts with at least one problem come back, so callers
 *  can render "0 warnings" as simply nothing rendered. */
export function previewWarnings(
  accounts: { _id: string; platform: Platform }[],
  input: { caption: string; media: MediaKind[]; hasLink: boolean },
): AccountWarning[] {
  return accounts
    .map((a) => ({ accountId: a._id, platform: a.platform, problems: validateForPlatform(a.platform, input) }))
    .filter((w) => w.problems.length > 0);
}

export type BindingCaptionLimit = { platform: Platform; limit: number };

/** Which selected platform has the tightest caption limit, and what that
 *  limit is - so the composer can show one clear, live number while typing
 *  instead of the owner finding out a post is too long only when it fails
 *  at Save or Approve (or, worse, at GHL). Null with nothing selected yet:
 *  there is no limit to be tight about. Ties keep whichever platform was
 *  seen first, which is stable for a caller that always passes accounts in
 *  the same order. */
export function tightestCaptionLimit(accounts: { platform: Platform }[]): BindingCaptionLimit | null {
  return accounts.reduce<BindingCaptionLimit | null>((tightest, a) => {
    const limit = captionLimit(a.platform);
    return !tightest || limit < tightest.limit ? { platform: a.platform, limit } : tightest;
  }, null);
}
