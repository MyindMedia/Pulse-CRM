/** Best-effort normalization of a typed phone number to E.164 (what Clerk and
 *  most SMS providers require). Returns null when there clearly isn't enough to
 *  form a number, so callers can reject invalid input.
 *
 *  Rules: keep a leading "+" if present, strip all other non-digits. A bare
 *  10-digit number is assumed US (+1); a leading 1 + 10 digits becomes +1…;
 *  anything already carrying a country code is passed through with a "+". */
export function normalizePhone(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) return null; // too short to be a real number

  if (hadPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`; // bare US number
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`; // already has a country code, just no "+"
}
