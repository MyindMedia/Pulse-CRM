/* Canonical SMS bodies. Every automated text is composed here so the wire
   format stays identical to the samples registered with the carriers in the
   A2P 10DLC campaign - reviewers compare live traffic against the samples on
   file, and drift is a re-vetting risk.

   "Pulse" leads every message because Pulse is the registered brand and the
   10DLC number is shared across every studio. The studio's own name and
   callback number come from its org record (name + contact.phone, captured in
   the onboarding wizard), so each text still reads as that studio's. */

export type SmsVars = Record<string, string | null | undefined>;

/** Display formatting for a callback number a human will dial. US numbers
 *  render as (213) 823-2720; anything else is passed through trimmed so
 *  international studios still get something dialable. */
export function displayPhone(raw?: string | null): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  const us =
    digits.length === 10 ? digits : digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
  if (us) return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
  return trimmed;
}

/** Substitute {vars} into a template.
 *
 *  Text wrapped in [[double brackets]] is an optional block: it survives only
 *  when every {var} inside it resolves to a non-empty value, otherwise the
 *  whole block is dropped. That is how a studio with no callback number on
 *  file simply loses the "Questions? Call ..." sentence instead of shipping a
 *  literal "{phone}" to a client. */
export function renderSms(template: string, vars: SmsVars): string {
  const value = (key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v).trim();
  };

  const withOptionals = template.replace(/\[\[([\s\S]*?)\]\]/g, (_m, block: string) => {
    const keys = [...String(block).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return keys.every((k) => value(k) !== "") ? String(block) : "";
  });

  return withOptionals
    .replace(/\{(\w+)\}/g, (_m, key: string) => value(key))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/* ── The registered message shapes ──────────────────────────────────────
   Keep these in lockstep with the A2P campaign samples. Changing the visible
   wording means re-registering samples with the carriers. */

/** Session reminder to the client (24h / 2h before). */
export const CLIENT_REMINDER =
  'Pulse: Reminder - "{title}" at {studio} starts {soon} ({date}).' +
  "[[ Questions? Call {phone}.]] Reply STOP to opt out, HELP for help.";

/** Session reminder to the engineer or staff member on the booking. */
export const STAFF_REMINDER =
  'Pulse: {studio} - you are booked for "{title}" {soon} ({date}). Reply STOP to opt out.';

/** Free-form text a studio sends a client by hand from the client screen.
 *  The operator's own words are the payload; we only prepend identification. */
export const MANUAL_CLIENT = "Pulse: {studio}: {body}";
