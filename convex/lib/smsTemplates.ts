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

/* ── Two-way flows (GHL number). The 2h client reminder becomes a question;
   YES/NO/REBOOK etc. are matched to an open smsPrompt by the inbound router. */

/** 2h-before confirm question to the client (replaces the plain 2h reminder). */
export const CLIENT_CONFIRM_2H =
  'Pulse: "{title}" at {studio} starts {soon} ({date}). Are you confirmed to come? ' +
  "Reply YES to confirm or NO if you cannot make it.[[ Questions? Call {phone}.]] " +
  "Reply STOP to opt out.";

export const CLIENT_CONFIRM_ACK =
  "Pulse: You are confirmed for \"{title}\" at {studio}. See you soon!";

/** Client said NO: the exact consequence + the 10-day rebooking hold. */
export const CLIENT_DECLINE_FOLLOWUP =
  "Pulse: Got it - you will lose this booking window at {studio}. Your deposit " +
  "will be held for rebooking for 10 days (until {holdDate}). Reply REBOOK to " +
  "use it toward a new time[[ or book at {link}]]. After {holdDate} the deposit " +
  "is forfeited.";

export const CLIENT_REBOOK_ACK =
  "Pulse: Your deposit at {studio} is on hold for a new booking until {holdDate}." +
  "[[ Pick a new time: {link}.]] The studio has been notified.";

/** 2h-before confirm question to the staffer working the session. */
export const STAFF_CONFIRM_2H =
  'Pulse: {studio} - are you confirmed to work "{title}" {soon} ({date})? ' +
  "Reply YES to confirm or NO if you cannot make it.";

export const STAFF_CONFIRM_ACK = "Pulse: Confirmed - thanks. See you at {studio}.";

export const STAFF_DECLINE_ACK =
  "Pulse: Got it - {studio} has been notified so they can find cover.";

/** Ack back to the manager who answered an APPROVE/DENY request. */
export const MGR_APPROVAL_ACK = "Pulse: Got it - {name} has been notified.";

/** Staff overtime check at the 8-hour mark. */
export const OT_PROMPT =
  "Pulse: {studio} - you have been clocked in 8 hours. Are you working " +
  "overtime? Reply YES to confirm overtime or NO to be clocked out at 8 hours.";

export const OT_YES_ACK =
  "Pulse: Overtime confirmed at {studio}. Your hours keep counting - remember to clock out.";

export const OT_NO_ACK =
  "Pulse: Done - you are clocked out at the 8-hour mark at {studio}.";

/** Intern 4-hour check-in + the manager approval leg. */
export const INTERN_PROMPT =
  "Pulse: {studio} - you have hit 4 hours. Interns need approval to continue. " +
  "Reply EXTEND to request permission, or clock out now.";

export const INTERN_EXTEND_ACK =
  "Pulse: Request sent - stay clocked in while a manager reviews. We will text you the decision.";

export const INTERN_APPROVED =
  "Pulse: Approved - you are cleared to keep working at {studio}. Remember to clock out.";

export const INTERN_DENIED =
  "Pulse: Not approved - please wrap up and clock out now at {studio}.";

export const INTERN_TIMEOUT =
  "Pulse: No approval came through, so your time at {studio} was capped at 4 hours and you are clocked out.";

export const MGR_INTERN_APPROVAL =
  "Pulse: {studio} - intern {name} has hit 4 hours and requests permission to " +
  "continue. Reply APPROVE or DENY.";

/** Generic manager alert (client declined, staff declined, OT unanswered...). */
export const MGR_ALERT = "Pulse: {studio} - {body}";

/** Reply to HELP or unmatched keywords. */
export const HELP_REPLY =
  "Pulse booking + studio alerts for {studio}.[[ Questions? Call {phone}.]] " +
  "Reply STOP to opt out.";

/** Reply to RESCHEDULE. */
export const RESCHEDULE_REPLY =
  "Pulse: No problem -[[ rebook at {link} or]] call the studio[[ at {phone}]] to find a new time.";

/** Ack when a client or staffer texts LATE. */
export const LATE_ACK = "Pulse: Thanks for the heads up - {studio} has been notified you are running late.";

/* ── Revenue recovery + owner awareness (pilot wave 2) ─────────────────── */

/** Freed slot offered to a waitlisted client. */
export const WAITLIST_OFFER =
  "Pulse: A slot just opened at {studio}: {date}[[ in {room}]]. " +
  "Reply CLAIM to take it - first reply wins. Reply STOP to opt out.";

export const WAITLIST_CLAIM_ACK =
  "Pulse: The {date} slot at {studio} is yours - the studio will confirm shortly." +
  "[[ Or book instantly: {link}.]]";

export const WAITLIST_TAKEN =
  "Pulse: That slot at {studio} was already taken.[[ See open times: {link}.]]";

/** Uncovered session offered to another engineer. */
export const COVER_OFFER =
  'Pulse: {studio} needs an engineer for "{title}" ({date}). ' +
  "Reply YES to take it - first reply wins.";

export const COVER_ACK = 'Pulse: "{title}" ({date}) is yours. {studio} has been notified.';

/** Post-session review request + the two response legs. */
export const REVIEW_REQUEST =
  "Pulse: Thanks for recording at {studio}! How was your session? " +
  "Reply with a rating 1-5. Reply STOP to opt out.";

export const REVIEW_THANKS =
  "Pulse: Thank you! We are glad the session landed. See you next time at {studio}.";

export const REVIEW_LOW_ACK =
  "Pulse: Sorry the session missed the mark - the owner has been notified personally and will make it right.";

/** Balance due before the session, with the checkout link. */
export const BALANCE_DUE_SMS =
  'Pulse: Your {amount} balance for "{title}" at {studio} is due before your session.' +
  "[[ Pay securely: {link}.]] Reply STOP to opt out.";

/** The 8am owner digest. Only sent on days with activity. */
export const OWNER_DIGEST =
  "Pulse daily - {studio}: {sessions} session(s) today ({revenue}){flags}. Have a good one.";
