import { moneyExact, shortDate, timeOfDay } from "@/lib/format";

/* What the "Deliver to client" card says and offers, as plain data. The card
   (src/components/calendar/session-delivery-card.tsx) only draws this, so the
   copy and the permission rules are unit tested without a browser:
   - an amount appears only when the server sent one (balanceCents is null for
     anyone without money sight);
   - "Send now anyway" and "Turn off link" appear only when the server says
     canRelease / canTurnOff. */

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
export const CANCELLED_LINE = "This booking was cancelled, so there is nothing to deliver.";
export const NOTHING_OWED_LINE = "Nothing is owed now. Tap Resend to send the files.";

export function sentToast(email: string | null): string {
  return email ? `Sent to ${email}` : "Sent";
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

  if (status.cancelled) {
    return { pill: null, lines: [line(CANCELLED_LINE)], actions: canUpload ? [ready(true)] : [] };
  }

  if (status.state === "awaiting_payment") {
    const pill: CardPill = { tone: "wait", label: "Waiting for payment", icon: "lock" };
    if (!status.balanceDue) {
      // Nothing owed (a payment path that missed the trigger): Resend releases.
      return { pill, lines: [line(NOTHING_OWED_LINE)], actions: [...resend, ...copy, ...off] };
    }
    const sent = status.lastSentAt
      ? `${name === "the client" ? "The client" : name} was emailed a pay link ${when(status.lastSentAt, now)}. `
      : `No pay link email has gone out to ${name} yet. `;
    const owed =
      status.balanceCents !== null && status.balanceCents > 0
        ? `${moneyExact(status.balanceCents)} is still owed.`
        : "A balance is still owed.";
    const release: CardAction[] = status.canRelease ? [{ key: "release", label: "Send now anyway", variant: "secondary" }] : [];
    return {
      pill,
      lines: [line(sent, strong(owed), " The download link sends by itself when it is paid.")],
      actions: [...release, ...copy, ...off],
    };
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
