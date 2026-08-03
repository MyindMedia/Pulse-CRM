/* Inbound SMS keyword parsing. Pure so the routing table is unit-testable.
   The router pairs the parsed intent with the sender's newest open smsPrompt;
   intents that need no prompt (stop/help/reschedule/late) act on their own. */

export type SmsIntent =
  | "stop"
  | "start"
  | "help"
  | "yes"
  | "no"
  | "extend"
  | "approve"
  | "deny"
  | "rebook"
  | "reschedule"
  | "late"
  | "claim"
  | "rating"
  | "text"; // free text - no keyword matched

/** The 1-5 star value of a "rating" intent, else null. */
export function parseRating(raw: string): number | null {
  const word = raw.trim().replace(/[.!?]+$/, "").trim();
  return /^[1-5]$/.test(word) ? Number(word) : null;
}

/** Classify a raw reply. Whole-message match (trimmed, case-insensitive,
 *  trailing punctuation ignored) so "Yes!" confirms but "yes we should add a
 *  vocal booth" stays a normal thread message. */
export function parseSmsIntent(raw: string): SmsIntent {
  const word = raw.trim().toUpperCase().replace(/[.!?]+$/, "").trim();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/.test(word)) return "stop";
  if (/^(START|UNSTOP)$/.test(word)) return "start";
  if (/^(HELP|INFO)$/.test(word)) return "help";
  if (/^(YES|Y|CONFIRM|CONFIRMED)$/.test(word)) return "yes";
  if (/^(NO|N|CANT|CAN'T|CANNOT)$/.test(word)) return "no";
  if (/^EXTEND$/.test(word)) return "extend";
  if (/^(APPROVE|APPROVED)$/.test(word)) return "approve";
  if (/^(DENY|DENIED|DECLINE)$/.test(word)) return "deny";
  if (/^(REBOOK|REBOOKING)$/.test(word)) return "rebook";
  if (/^(RESCHEDULE|RESCHED)$/.test(word)) return "reschedule";
  if (/^(LATE|RUNNING LATE)$/.test(word)) return "late";
  if (/^CLAIM$/.test(word)) return "claim";
  if (/^[1-5]$/.test(word)) return "rating";
  return "text";
}
