/* ============================================================
   PII redaction - pure helpers for GDPR erasure.

   When a client exercises their right to be forgotten, free text that
   may carry their identity (session titles, notes, message bodies) is
   scrubbed of the identifying terms. Pure + unit-tested.
   ============================================================ */

/** Replace every occurrence of any term (name, email, phone) with a marker,
 *  case-insensitive. Terms under 2 chars are ignored (too noisy). Returns the
 *  input unchanged when it is empty/undefined. */
export function redactText(
  text: string | undefined | null,
  terms: (string | undefined | null)[],
  marker = "[erased]",
): string | undefined {
  if (!text) return text ?? undefined;
  let out = text;
  for (const t of terms) {
    const term = t?.trim();
    if (!term || term.length < 2) continue;
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), marker);
  }
  return out;
}

/** The identifying terms for a client, longest first (so a full name is
 *  replaced before its parts). */
export function piiTerms(artist: { name?: string; email?: string; phone?: string }): string[] {
  return [artist.name, artist.email, artist.phone]
    .map((t) => t?.trim())
    .filter((t): t is string => !!t && t.length >= 2)
    .sort((a, b) => b.length - a.length);
}
