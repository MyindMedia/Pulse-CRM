/* ============================================================
   Deal-text consent and caps (openspec/changes/off-peak-and-google-reviews).

   Deal texts are marketing, so they need the client's own opt-in, recorded
   with the exact words they agreed to. The booking form shows
   DEALS_DISCLOSURE next to an unchecked box; replying DEALS by text is the
   other way in. STOP (smsOptOuts) still beats everything.
   ============================================================ */

/** Bump when DEALS_DISCLOSURE changes, so every stored consent names the
 *  words that client saw. */
export const DEALS_CONSENT_VERSION = "2026-10-21";

export const DEALS_DISCLOSURE =
  "Text me deals and open studio time. Up to 4 texts a month. Consent is not required to book. Msg & data rates may apply. Reply STOP to opt out.";

/** Eight days between deal texts to one client, so no 31-day stretch holds
 *  more than the four DEALS_DISCLOSURE promises. */
export const DEAL_TEXT_COOLDOWN_MS = 8 * 24 * 3_600_000;

/** Deal texts only go out between 10am and 7pm, studio time. */
export const DEAL_SEND_START_HOUR = 10;
export const DEAL_SEND_END_HOUR = 19;

/** Platform switch: deal texts are marketing, and the shared number's carrier
 *  campaign must cover marketing before any go out. Until DEAL_TEXTS_LIVE is
 *  "true" in the Convex env, studios can turn them on but nothing is drafted
 *  or sent. Consent is still collected. */
export function dealTextsLive(): boolean {
  return process.env.DEAL_TEXTS_LIVE === "true";
}

export function dealsEnabled(org: { dealTexts?: { enabled: boolean } } | null | undefined): boolean {
  return dealTextsLive() && org?.dealTexts?.enabled === true;
}

export function dealsMode(org: { dealTexts?: { mode: "approve" | "auto" } } | null | undefined): "approve" | "auto" {
  return org?.dealTexts?.mode === "auto" ? "auto" : "approve";
}

/** May this client get a deal text right now? (Opt-out is checked separately,
 *  by phone, against smsOptOuts.) */
export function canGetDealText(
  a: { dealsOptInAt?: number; lastDealTextAt?: number; phone?: string; erasedAt?: number },
  now: number,
): boolean {
  if (!a.dealsOptInAt || !a.phone || a.erasedAt) return false;
  return !a.lastDealTextAt || now - a.lastDealTextAt >= DEAL_TEXT_COOLDOWN_MS;
}

/* The Pulse agent's verdict on a gap (Jev Choice send/skip), turned into
   what happens next. A confident "skip" drops the gap; a confident "send"
   goes out on its own only when the studio chose Auto; everything else,
   including no answer at all, waits in the inbox for an owner or manager. */
export const SKIP_DROP_CONFIDENCE = 0.3;
export const AUTO_SEND_CONFIDENCE = 0.6;

export function decideGapDeal(
  answer: { choice: string; confidence: number } | null,
  mode: "approve" | "auto",
): "drop" | "inbox" | "auto" {
  if (!answer) return "inbox";
  if (answer.choice === "skip") return answer.confidence >= SKIP_DROP_CONFIDENCE ? "drop" : "inbox";
  if (answer.choice === "send" && mode === "auto" && answer.confidence >= AUTO_SEND_CONFIDENCE) return "auto";
  return "inbox";
}

/** The next moment inside the 10am-7pm send window, studio time: `now` itself
 *  when already inside it, else the top of the next hour that is. */
export function nextSendTime(now: number, hourOf: (ts: number) => number): number {
  const h = hourOf(now);
  if (h >= DEAL_SEND_START_HOUR && h < DEAL_SEND_END_HOUR) return now;
  let t = Math.ceil(now / 3_600_000) * 3_600_000;
  for (let i = 0; i < 48; i++, t += 3_600_000) {
    const hh = hourOf(t);
    if (hh >= DEAL_SEND_START_HOUR && hh < DEAL_SEND_END_HOUR) return t;
  }
  return t;
}
