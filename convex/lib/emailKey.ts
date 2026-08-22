/* ============================================================
   Email as an identifier.

   An email address is case-insensitive in the part that matters, and the
   only thing anyone ever types differently is the case. Pulse stored
   whatever was typed and then compared it exactly, which is a bug that
   hides until the day it locks somebody out: an owner seat saved as
   "Info@playbackrecording.com" never matched the invite for
   "info@playbackrecording.com", so the studio's owner signed in to an error
   screen with his workspace sitting right there.

   Two rules, and both are needed:

     WRITE  normalizeEmail() before storing. Indexes match bytes, so a row
            saved in mixed case is unreachable by an indexed lookup no
            matter how careful the reader is.
     READ   sameEmail() / findByEmail() when comparing. Rows written before
            this existed, or by an integration we do not control, are still
            in whatever case they arrived in.

   Local-part case is technically significant in the RFC, and no mail
   provider anyone uses honours that. Matching case-insensitively is what
   every user expects and what every other system here already does.
   ============================================================ */

/** Lowercased and trimmed, for storing and for comparing. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** True when two addresses are the same person. Blank never matches blank -
 *  an absent email must not make two records the same record. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeEmail(a);
  return left.length > 0 && left === normalizeEmail(b);
}

/** The first row whose email is this one, whatever case either is in. */
export function findByEmail<T extends { email?: string | null }>(
  rows: T[],
  email: string | null | undefined,
): T | undefined {
  return rows.find((r) => sameEmail(r.email, email));
}
