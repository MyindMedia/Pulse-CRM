export const LINK_IN_BIO = "Link in bio";
const SUFFIX = `\n\n${LINK_IN_BIO}`;

/**
 * Instagram does not render a clickable link inside a caption, so a post
 * whose accounts are all Instagram gets "Link in bio" appended instead of a
 * real tracked link. This has to be a two-way door, not append-only:
 * widening the account mix (adding Facebook) or turning the link back on
 * must retract the phrase, or a stale "Link in bio" ships next to a real
 * link, or into a caption that no longer needs it. Symmetric by
 * construction - append adds exactly `SUFFIX` to the end, retract removes
 * exactly that same trailing text if present - so calling this repeatedly
 * as the mix or the toggle changes never duplicates and never leaves a
 * partial phrase behind.
 */
export function applyLinkInBioSuffix(
  caption: string,
  input: { allInstagramSelected: boolean; includeBookingLink: boolean },
): string {
  const shouldAppend = input.allInstagramSelected && !input.includeBookingLink;
  const hasSuffix = caption.endsWith(SUFFIX);
  if (shouldAppend) {
    return hasSuffix ? caption : `${caption}${SUFFIX}`;
  }
  return hasSuffix ? caption.slice(0, -SUFFIX.length) : caption;
}

export type MixBaselineResult = { reapplyDefault: boolean; baseline: boolean };

/**
 * The composer re-applies the includeBookingLink default only when the
 * account mix's "is everyone Instagram" flag genuinely transitions, not on
 * every render and not via a sticky "touched" flag - see composer.tsx's own
 * comment on the effect that calls this. That effect owns exactly one ref
 * (the previous baseline); this function is the pure decision underneath it,
 * so the tricky part (three distinct cases, easy to get one wrong) is
 * testable without mounting anything.
 *
 * `previousBaseline` is `null` in exactly two situations, and both must
 * behave the same way: the very first settled mix a fresh compose or a
 * newly-hydrated post ever reports, and the first mix reported right after
 * the composer's load effect resets the baseline for a DIFFERENT post
 * (opening a second ?post= link in the same mount, without a full reload).
 * In both cases there is nothing yet to compare `current` against, so
 * capturing it as the new baseline must never itself count as a "change" -
 * that would stomp a value the load effect just restored from a saved
 * draft, or the toggle's own initial default on a fresh compose.
 */
export function nextMixBaseline(previousBaseline: boolean | null, current: boolean): MixBaselineResult {
  if (previousBaseline === current) return { reapplyDefault: false, baseline: current };
  return { reapplyDefault: previousBaseline !== null, baseline: current };
}
