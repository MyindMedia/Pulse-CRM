/* ============================================================
   Codes made by the weekly quiet-hour (rate-cut) sweep.

   The sweep used to build a code from the room, weekday, part of day
   and percentage (e.g. STUDIMONMOR20) and write it into
   orgs.discountCodes as a permanent, unlimited code. Those are easy to
   guess and nobody approved them. Now:
     - new sweep codes carry a random suffix and live only as a promo
       row that waits for the owner's approval;
     - the old permanent ones are recognised here so checkout refuses them.
   ============================================================ */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PARTS = ["morning (9am-12pm)", "afternoon (12pm-5pm)", "evening (5pm-10pm)"];

const CODE_RE = /^[A-Z]{0,5}(SUN|MON|TUE|WED|THU|FRI|SAT)(MOR|AFT|EVE)(15|20)$/;
const LABEL_RE = new RegExp(
  `\\s(${WEEKDAYS.join("|")})\\s(${PARTS.map((p) => p.replace(/[()]/g, "\\$&")).join("|")})$`,
);

/** True for an orgs.discountCodes entry the old weekly sweep wrote: its code
 *  has the sweep's shape AND its label is "{room} {weekday} {part of day}".
 *  Both must match, so an owner's own code is never caught by accident. */
export function isSweepMadeLegacyCode(entry: { code: string; label?: string | null }): boolean {
  const code = entry.code.trim().toUpperCase();
  return CODE_RE.test(code) && !!entry.label && LABEL_RE.test(entry.label);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

/** A short random suffix so a sweep code cannot be guessed from the room
 *  and time. 5 characters of 32 = about 33 million combinations. */
export function randomCodeSuffix(length = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** The code a new sweep promo is published under. */
export function sweepPromoCode(baseCode: string): string {
  return `${baseCode}-${randomCodeSuffix()}`;
}
