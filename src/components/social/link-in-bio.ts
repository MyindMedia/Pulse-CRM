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
