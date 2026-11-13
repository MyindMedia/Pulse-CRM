import { moneyExact, shortDate, timeOfDay } from "@/lib/format";

/* What the "Deliver to client" card says and offers, as plain data. The card
   (src/components/calendar/session-delivery-card.tsx) only draws this, so the
   copy and the permission rules are unit tested without a browser:
   - an amount appears only when the server sent one (balanceCents is null for
     anyone without money sight);
   - "Send now anyway" and "Turn off link" appear only when the server says
     canRelease / canTurnOff;
   - when the client has no online way to pay exactly what is owed
     (onlinePay "none"), a caller with money sight gets the team card table
     (Addendum 5, R5-02): the first matching row of the facts in payFacts
     says what is open, what is drafted, and what to do; everyone else sees
     only that a balance is owed. */

export type DeliveryState = "none" | "awaiting_payment" | "released" | "off";

/** The fields of sessionDelivery.status the card reads. */
export type DeliveryStatus = {
  /** A DeliveryState; anything else is drawn as "none". */
  state: DeliveryState | (string & {});
  finalCount: number;
  clientFirstName: string;
  clientEmail: string | null;
  balanceDue: boolean;
  balanceCents: number | null;
  sentTo: string | null;
  lastSentAt: number | null;
  firstOpenedAt: number | null;
  downloadCount: number;
  expiresAt: number | null;
  offAt: number | null;
  canMarkReady: boolean;
  canRelease: boolean;
  canTurnOff: boolean;
  cancelled: boolean;
  /** The booking was a no-show (R4-02): treated like cancelled. */
  noShow: boolean;
  /** Where the client can pay online for exactly what is owed (payTargetFor). */
  onlinePay: "invoice" | "checkout" | "none" | (string & {});
  /** The invoice facts the team card reads; null for callers without money sight. */
  payFacts: PayFacts | null;
};

/** sessionDelivery.status.payFacts (Addendum 5). */
export type PayFacts = {
  /** Open invoices (sent, viewed or overdue), oldest first, at most 5. */
  openInvoices: Array<{ number: string; cents: number }>;
  /** The real count of open invoices; may exceed openInvoices.length. */
  openInvoiceCount: number;
  /** Count of draft invoices on the booking. */
  draftInvoices: number;
  pricesHidden: boolean;
  cardsOn: boolean;
};

export type CardActionKey = "ready" | "release" | "resend" | "copy" | "off";
export type CardAction = {
  key: CardActionKey;
  label: string;
  variant: "primary" | "secondary" | "ghost";
  disabled?: boolean;
};
export type CardText = { text: string; strong?: boolean };
export type CardLine = { parts: CardText[]; tone?: "caution" | "mono" };
export type CardPill = { tone: "ok" | "wait" | "off"; label: string; icon: "check" | "lock" | null };
export type CardView = { pill: CardPill | null; lines: CardLine[]; actions: CardAction[] };

export const PAY_LINK_TOAST = "Pay link sent. The files unlock when the balance is paid.";
/** The same moment when the email carries no Pay button (onlinePay "none"). */
export const BALANCE_EMAIL_TOAST = "Balance email sent. The files unlock when the balance is paid.";
export const CANCELLED_LINE = "This booking was cancelled, so there is nothing to deliver.";
export const NO_SHOW_LINE = "This booking was a no-show, so there is nothing to deliver.";
export const NOTHING_OWED_LINE = "Nothing is owed now. Tap Resend to send the files.";
export const NOTHING_OWED_NO_EMAIL_LINE = (name: string) =>
  `Nothing is owed now, but there is no email on file. Add one for ${name}, then tap Resend.`;

export function sentToast(email: string | null): string {
  return email ? `Sent to ${email}` : "Sent";
}

/** The toast after a waiting-for-payment email: it names a pay link only when
 *  the email had one. */
export function payToast(onlinePay: DeliveryStatus["onlinePay"]): string {
  return onlinePay === "none" ? BALANCE_EMAIL_TOAST : PAY_LINK_TOAST;
}

/** The team card table (Addendum 5, R5-02). Only for callers with money sight
 *  (payFacts non-null) while something is owed and onlinePay is "none". The
 *  first matching row wins; rows 1 and 2 need the amount owed to say what
 *  would match it. */
export function cardTodoLine(facts: PayFacts, owedCents: number | null, name: string): string {
  const owed = owedCents !== null ? `${moneyExact(owedCents)} is owed.` : "A balance is still owed.";
  // 1: exactly one open invoice, and its amount is what is owed.
  if (facts.openInvoiceCount === 1 && owedCents !== null && facts.openInvoices[0]?.cents === owedCents) {
    const [only] = facts.openInvoices;
    return `Invoice ${only.number} for ${moneyExact(only.cents)} is open. The files unlock when it is paid.`;
  }
  // 2: one or more open invoices otherwise (wrong amount, or more than one).
  if (facts.openInvoiceCount > 0) {
    const shown = facts.openInvoices.slice(0, 5);
    const more = facts.openInvoiceCount > shown.length ? ` and ${facts.openInvoiceCount - shown.length} more` : "";
    const list = shown.map((i) => `${i.number} (${moneyExact(i.cents)})`).join(", ");
    return `Open invoices: ${list}${more}. ${owed} Leave one open invoice for exactly that amount so the files unlock when it is paid.`;
  }
  // 3: a draft exists but nothing is open.
  if (facts.draftInvoices > 0) return `A balance invoice is drafted but not sent. Send it so ${name} can pay.`;
  // 4: prices are hidden, so the team sends the invoice itself.
  if (facts.pricesHidden) return `Prices are hidden on this booking. Send ${name} an invoice to collect the balance.`;
  // 5: none of the above.
  return `There is no online pay link for this balance. Send ${name} an invoice for it.`;
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "today at 2:41 PM", "Nov 11 at 2:41 PM". */
function when(ts: number, now: number): string {
  return `${sameDay(ts, now) ? "today" : shortDate(ts)} at ${timeOfDay(ts)}`;
}

/** "2:41 PM" today, "Nov 11 at 2:41 PM" on another day. */
function openedAt(ts: number, now: number): string {
  return sameDay(ts, now) ? timeOfDay(ts) : `${shortDate(ts)} at ${timeOfDay(ts)}`;
}

const line = (...parts: (string | CardText)[]): CardLine => ({
  parts: parts.map((p) => (typeof p === "string" ? { text: p } : p)),
});
const strong = (text: string): CardText => ({ text, strong: true });

export function deliveryCardView(status: DeliveryStatus, opts: { canUpload: boolean; now: number }): CardView {
  const { canUpload, now } = opts;
  const name = status.clientFirstName.trim() || "the client";
  const Name = name === "the client" ? "The client" : name;
  const n = status.finalCount;

  const ready = (disabled: boolean): CardAction => ({ key: "ready", label: "Ready to deliver", variant: "primary", disabled });
  const copy: CardAction[] = canUpload ? [{ key: "copy", label: "Copy link", variant: "ghost" }] : [];
  const off: CardAction[] = status.canTurnOff ? [{ key: "off", label: "Turn off link", variant: "ghost" }] : [];
  const resend: CardAction[] = canUpload ? [{ key: "resend", label: "Resend", variant: "secondary" }] : [];

  // A no-show bills a fee, not the rate, so there is nothing to deliver for it
  // either (R4-02): the same card as a cancelled booking.
  if (status.cancelled || status.noShow) {
    return { pill: null, lines: [line(status.cancelled ? CANCELLED_LINE : NO_SHOW_LINE)], actions: canUpload ? [ready(true)] : [] };
  }

  if (status.state === "awaiting_payment") {
    const pill: CardPill = { tone: "wait", label: "Waiting for payment", icon: "lock" };
    if (!status.balanceDue) {
      // Nothing owed (a payment path that missed the trigger). Resend releases,
      // but with no email on file it would fail, so staff are told to add one.
      if (!status.clientEmail) {
        return { pill, lines: [line(NOTHING_OWED_NO_EMAIL_LINE(name))], actions: [...copy, ...off] };
      }
      return { pill, lines: [line(NOTHING_OWED_LINE)], actions: [...resend, ...copy, ...off] };
    }
    // With no online pay target the email had no Pay button, so it is not
    // called a pay link here.
    const noLink = status.onlinePay === "none";
    const sent = status.lastSentAt
      ? `${Name} was emailed ${noLink ? "about the balance" : "a pay link"} ${when(status.lastSentAt, now)}. `
      : noLink
        ? `No email about the balance has gone out to ${name} yet. `
        : `No pay link email has gone out to ${name} yet. `;
    const seesMoney = status.balanceCents !== null;
    const owed =
      seesMoney && status.balanceCents! > 0 ? `${moneyExact(status.balanceCents!)} is still owed.` : "A balance is still owed.";
    const lines: CardLine[] = [line(sent, strong(owed), " The download link sends by itself when it is paid.")];
    const todo = status.payFacts && noLink ? cardTodoLine(status.payFacts, status.balanceCents, name) : null;
    if (todo) lines.push({ parts: [{ text: todo }], tone: "caution" });
    const release: CardAction[] = status.canRelease ? [{ key: "release", label: "Send now anyway", variant: "secondary" }] : [];
    return { pill, lines, actions: [...release, ...copy, ...off] };
  }

  if (status.state === "released") {
    const expired = status.expiresAt !== null && status.expiresAt <= now;
    const stats = [
      status.firstOpenedAt ? `Opened ${openedAt(status.firstOpenedAt, now)}` : "Not opened yet",
      `${status.downloadCount} download${status.downloadCount === 1 ? "" : "s"}`,
      status.expiresAt ? (expired ? `link expired ${shortDate(status.expiresAt)}` : `link works until ${shortDate(status.expiresAt)}`) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      pill: { tone: "ok", label: "Sent", icon: "check" },
      lines: [
        line(strong(`Sent to ${status.sentTo ?? "the email on file"}`), status.lastSentAt ? ` ${when(status.lastSentAt, now)}.` : "."),
        { parts: [{ text: stats }], tone: "mono" },
      ],
      actions: [...resend, ...copy, ...off],
    };
  }

  if (status.state === "off") {
    return {
      pill: { tone: "off", label: "Link off", icon: null },
      lines: [
        line(
          status.offAt ? `The link was turned off on ${shortDate(status.offAt)}. ` : "The link was turned off. ",
          `${Name} can no longer download.`,
        ),
      ],
      actions: canUpload ? [ready(!status.canMarkReady)] : [],
    };
  }

  // Not sent yet.
  const noEmail = `No email on file. Add one for ${name} to deliver.`;
  const lines: CardLine[] = [];
  if (n === 0) {
    lines.push(line(status.clientEmail ? "Mark at least one file Final to deliver." : `Mark at least one file Final to deliver. ${noEmail}`));
  } else {
    const label = `${n} file${n === 1 ? "" : "s"} marked Final.`;
    if (status.clientEmail) {
      lines.push(
        line(
          strong(label),
          status.balanceDue
            ? ` ${Name} gets a download link by email once the booking is paid.`
            : ` ${Name} gets a download link by email as soon as you tap Ready to deliver.`,
        ),
      );
    } else {
      lines.push(line(strong(label)));
      lines.push({ parts: [{ text: noEmail }], tone: "caution" });
    }
  }
  return { pill: null, lines, actions: canUpload ? [ready(!status.canMarkReady)] : [] };
}
