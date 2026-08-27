import type { Platform } from "@convex/lib/ghl";
// `rules.ts` imports only `import type { Platform }` from ghl.ts, which
// erases at compile - so validateForPlatform itself carries no server-only
// dependency and is safe to run in the browser for live warnings, the same
// checks the backend applies at save time (convex/marketing/posts.ts
// validateInput). This file exists so the per-account loop is one pure,
// testable function rather than logic buried inside composer.tsx.
import { validateForPlatform, type MediaKind } from "@convex/marketing/rules";

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
