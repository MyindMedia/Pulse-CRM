/* Signup leads: the rules, kept pure so the tests can pin them.

   Consent: most of the world is told under the email field and may get the
   reminders (US CAN-SPAM allows that with a working unsubscribe). The EU,
   EEA, UK and Switzerland need a ticked box first. A country we could not
   read is treated as one that needs the box: the safe default is the one
   that cannot send mail nobody agreed to. */

export type LeadConsent = "notice" | "opt_in" | "none";

const OPT_IN_COUNTRIES = new Set([
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA, UK, Switzerland
  "IS", "LI", "NO", "GB", "CH",
]);

/** Does a visitor from this country need to tick a box before we email? */
export function needsOptIn(country: string | undefined | null): boolean {
  const c = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return true;
  return OPT_IN_COUNTRIES.has(c);
}

/** What the lead agreed to, decided on the server from the country and the box. */
export function leadConsent(country: string | undefined | null, optedIn: boolean): LeadConsent {
  if (optedIn) return "opt_in";
  return needsOptIn(country) ? "none" : "notice";
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** When each reminder goes, counted from the latest start. */
export const NUDGE_OFFSETS = [1 * HOUR, 1 * DAY, 4 * DAY] as const;

/** A lead this old is never emailed, so switching reminders on late does not
 *  mail people who started weeks ago. */
export const LEAD_MAX_AGE_MS = 7 * DAY;

/** Unconverted leads are deleted this long after their last start. */
export const LEAD_RETENTION_MS = 180 * DAY;

/** When the next reminder is due, or undefined when all have gone. */
export function nextNudgeAt(startedAt: number, nudgesSent: number): number | undefined {
  const offset = NUDGE_OFFSETS[nudgesSent];
  return offset === undefined ? undefined : startedAt + offset;
}

/** 32 hex characters from the platform CSPRNG. */
export function newLeadToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function validLeadToken(token: string): boolean {
  return /^[a-f0-9]{32}$/.test(token);
}

export function reminderLiveFlag(): boolean {
  return (process.env.TRIAL_NUDGES_LIVE ?? "").trim().toLowerCase() === "true";
}
