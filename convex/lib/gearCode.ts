/* Gear label codes. A code is an opaque id printed on a sticker as a QR code
   and a Code 128 bar code. It carries no secret and no studio id: it only
   means something to a signed-in member of the studio that owns the item. */

/** No 0/O/1/I/L, so a code read off a sticker by eye survives. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_PREFIX = "PX";

/** Upper-case and trim. Scanners and typists differ in case and spacing. */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

/** Letters, digits and dashes, 3 to 32 characters. */
export function isValidCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code);
}

/** A fresh random code such as PX-7K3M9Q2T. Uniqueness is checked by the caller. */
export function generateCode(random: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `${CODE_PREFIX}-${body}`;
}

/** True when an open check-out is past its due time. */
export function isOverdue(row: { dueAt?: number; inAt?: number }, now: number): boolean {
  return row.inAt === undefined && row.dueAt !== undefined && row.dueAt < now;
}
