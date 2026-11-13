import { describe, it, expect } from "vitest";
import {
  BALANCE_EMAIL_TOAST,
  PAY_LINK_TOAST,
  deliveryCardView,
  payToast,
  sentToast,
  type CardView,
  type DeliveryStatus,
} from "./delivery-card-view";

const NOW = new Date(2026, 10, 13, 15, 0).getTime();
const EARLIER_TODAY = new Date(2026, 10, 13, 14, 41).getTime();
const DAYS_AGO = new Date(2026, 10, 10, 15, 2).getTime();

function status(over: Partial<DeliveryStatus> = {}): DeliveryStatus {
  return {
    state: "none",
    finalCount: 2,
    clientFirstName: "Jordan",
    clientEmail: "jordan.ellis@example.com",
    balanceDue: true,
    balanceCents: 18000,
    sentTo: null,
    lastSentAt: null,
    firstOpenedAt: null,
    downloadCount: 0,
    expiresAt: null,
    offAt: null,
    canMarkReady: true,
    canRelease: true,
    canTurnOff: true,
    cancelled: false,
    onlinePay: "checkout",
    onlinePayReason: null,
    ...over,
  };
}

/** Every string the card would put on screen. */
function texts(view: CardView): string[] {
  return [
    ...(view.pill ? [view.pill.label] : []),
    ...view.lines.map((l) => l.parts.map((p) => p.text).join("")),
    ...view.actions.map((a) => a.label),
  ];
}
const labels = (view: CardView) => view.actions.map((a) => a.label);
const body = (view: CardView) => view.lines.map((l) => l.parts.map((p) => p.text).join("")).join(" ");

const STATES: DeliveryStatus["state"][] = ["none", "awaiting_payment", "released", "off"];

describe("deliveryCardView: no money sight (A-11)", () => {
  it("with balanceCents null, no state shows a dollar sign or an amount", () => {
    for (const state of STATES) {
      for (const balanceDue of [true, false]) {
        for (const cancelled of [true, false]) {
          for (const canUpload of [true, false]) {
            const view = deliveryCardView(
              status({ state, balanceDue, cancelled, balanceCents: null, lastSentAt: EARLIER_TODAY, sentTo: "a@b.co", expiresAt: NOW + 1e9, offAt: DAYS_AGO, firstOpenedAt: DAYS_AGO, downloadCount: 3 }),
              { canUpload, now: NOW },
            );
            for (const t of texts(view)) {
              expect(t).not.toContain("$");
              expect(t).not.toMatch(/\d\.00/);
            }
          }
        }
      }
    }
  });

  it("says a balance is owed without the amount", () => {
    const view = deliveryCardView(status({ state: "awaiting_payment", balanceCents: null, canRelease: false, canTurnOff: false }), { canUpload: true, now: NOW });
    expect(body(view)).toContain("A balance is still owed.");
  });
});

describe("deliveryCardView: actions follow the server's permissions", () => {
  it("never offers Send now anyway or Turn off link when the server says no", () => {
    for (const state of STATES) {
      for (const balanceDue of [true, false]) {
        const view = deliveryCardView(status({ state, balanceDue, canRelease: false, canTurnOff: false }), { canUpload: true, now: NOW });
        expect(labels(view)).not.toContain("Send now anyway");
        expect(labels(view)).not.toContain("Turn off link");
      }
    }
  });

  it("offers them when allowed and a balance is owed", () => {
    const view = deliveryCardView(status({ state: "awaiting_payment" }), { canUpload: true, now: NOW });
    expect(labels(view)).toEqual(["Send now anyway", "Copy link", "Turn off link"]);
  });

  it("someone who cannot upload sees no Ready, Resend or Copy link", () => {
    for (const state of STATES) {
      const view = deliveryCardView(status({ state, canRelease: false, canTurnOff: false }), { canUpload: false, now: NOW });
      expect(view.actions).toEqual([]);
    }
  });
});

describe("deliveryCardView: copy (F2-27)", () => {
  it("shows the owed amount with cents for money sight", () => {
    const view = deliveryCardView(status({ state: "awaiting_payment", lastSentAt: EARLIER_TODAY }), { canUpload: true, now: NOW });
    expect(view.pill).toMatchObject({ tone: "wait", label: "Waiting for payment" });
    expect(body(view)).toContain("Jordan was emailed a pay link today at 2:41");
    expect(body(view)).toContain("$180.00 is still owed.");
    expect(body(view)).toContain("The download link sends by itself when it is paid.");
  });

  it("waiting with nothing owed says only the Resend line, and offers Resend", () => {
    const view = deliveryCardView(status({ state: "awaiting_payment", balanceDue: false, balanceCents: 0 }), { canUpload: true, now: NOW });
    expect(texts({ ...view, pill: null, actions: [] })).toEqual(["Nothing is owed now. Tap Resend to send the files."]);
    expect(labels(view)).toEqual(["Resend", "Copy link", "Turn off link"]);
  });

  it("no email on file names the client and disables Ready", () => {
    const view = deliveryCardView(status({ clientEmail: null, canMarkReady: false }), { canUpload: true, now: NOW });
    expect(body(view)).toContain("No email on file. Add one for Jordan to deliver.");
    expect(view.actions).toEqual([expect.objectContaining({ key: "ready", label: "Ready to deliver", disabled: true })]);
  });

  it("no Final files and no email gives both lines", () => {
    const view = deliveryCardView(status({ finalCount: 0, clientEmail: null, canMarkReady: false }), { canUpload: true, now: NOW });
    expect(body(view)).toBe("Mark at least one file Final to deliver. No email on file. Add one for Jordan to deliver.");
  });

  it("a cancelled booking says there is nothing to deliver, with Ready disabled", () => {
    for (const state of STATES) {
      const view = deliveryCardView(status({ state, cancelled: true, canMarkReady: false, canRelease: false }), { canUpload: true, now: NOW });
      expect(body(view)).toBe("This booking was cancelled, so there is nothing to deliver.");
      expect(view.pill).toBeNull();
      expect(view.actions).toEqual([expect.objectContaining({ key: "ready", disabled: true })]);
    }
  });

  it("Opened shows only the time today and the date on another day", () => {
    const today = deliveryCardView(status({ state: "released", firstOpenedAt: EARLIER_TODAY, downloadCount: 3, sentTo: "a@b.co" }), { canUpload: true, now: NOW });
    const mono = (v: CardView) => v.lines.find((l) => l.tone === "mono")!.parts.map((p) => p.text).join("");
    expect(mono(today)).toMatch(/^Opened 2:41\sPM · 3 downloads/);
    const before = deliveryCardView(status({ state: "released", firstOpenedAt: DAYS_AGO, downloadCount: 1, sentTo: "a@b.co" }), { canUpload: true, now: NOW });
    expect(mono(before)).toMatch(/^Opened Nov 10 at 3:02\sPM · 1 download/);
  });

  it("released shows who it went to and offers Resend", () => {
    const view = deliveryCardView(status({ state: "released", sentTo: "jordan.ellis@example.com", lastSentAt: EARLIER_TODAY }), { canUpload: true, now: NOW });
    expect(view.pill).toMatchObject({ tone: "ok", label: "Sent" });
    expect(body(view)).toContain("Sent to jordan.ellis@example.com today at 2:41");
    expect(labels(view)).toEqual(["Resend", "Copy link", "Turn off link"]);
  });
});

describe("deliveryCardView: no online pay link (R3-05)", () => {
  const REASONS = {
    invoice_not_sent: "Send the balance invoice so Jordan can pay online.",
    amount_mismatch: "There is no online pay link for this balance. Send Jordan an invoice for it.",
    prices_hidden: "Prices are hidden on this booking. Send Jordan an invoice to collect the balance.",
  } as const;
  const ALL_REASON_LINES = Object.values(REASONS);
  const waiting = (over: Partial<DeliveryStatus>) =>
    deliveryCardView(status({ state: "awaiting_payment", onlinePay: "none", lastSentAt: EARLIER_TODAY, ...over }), { canUpload: true, now: NOW });

  it("tells a caller who sees money what to do, for each reason, word for word", () => {
    for (const [reason, copy] of Object.entries(REASONS)) {
      const view = waiting({ onlinePayReason: reason as keyof typeof REASONS });
      expect(texts(view)).toContain(copy);
      for (const other of ALL_REASON_LINES.filter((l) => l !== copy)) expect(body(view)).not.toContain(other);
      expect(body(view)).toContain("$180.00 is still owed.");
    }
  });

  it("uses the client fallback when there is no first name", () => {
    const view = waiting({ onlinePayReason: "amount_mismatch", clientFirstName: "" });
    expect(texts(view)).toContain("There is no online pay link for this balance. Send the client an invoice for it.");
  });

  it("a caller without money sight sees only that a balance is owed: no reason line, no dollar sign", () => {
    for (const reason of [...Object.keys(REASONS), "nothing_owed", null] as DeliveryStatus["onlinePayReason"][]) {
      const view = waiting({ onlinePayReason: reason, balanceCents: null, canRelease: false, canTurnOff: false });
      expect(body(view)).toContain("A balance is still owed.");
      for (const line of ALL_REASON_LINES) expect(body(view)).not.toContain(line);
      for (const t of texts(view)) {
        expect(t).not.toContain("$");
        expect(t).not.toMatch(/\d\.00/);
      }
    }
  });

  it("with no pay link, the card does not say a pay link was emailed", () => {
    const view = waiting({ onlinePayReason: "invoice_not_sent" });
    expect(body(view)).not.toContain("pay link today");
    expect(body(view)).toContain("Jordan was emailed about the balance today at 2:41");
    const never = waiting({ onlinePayReason: "invoice_not_sent", lastSentAt: null });
    expect(body(never)).toContain("No email about the balance has gone out to Jordan yet.");
  });

  it("with an online pay target there is no reason line and the pay link copy stays", () => {
    for (const onlinePay of ["invoice", "checkout"] as const) {
      const view = waiting({ onlinePay, onlinePayReason: null });
      expect(body(view)).toContain("Jordan was emailed a pay link today at 2:41");
      for (const line of ALL_REASON_LINES) expect(body(view)).not.toContain(line);
    }
  });

  it("nothing owed keeps the Resend line only, whatever the pay target", () => {
    const view = waiting({ balanceDue: false, balanceCents: 0, onlinePayReason: "nothing_owed" });
    expect(texts({ ...view, pill: null, actions: [] })).toEqual(["Nothing is owed now. Tap Resend to send the files."]);
  });

  it("the reason line is a caution line of its own", () => {
    const view = waiting({ onlinePayReason: "prices_hidden" });
    expect(view.lines.at(-1)).toEqual({ parts: [{ text: REASONS.prices_hidden }], tone: "caution" });
  });
});

describe("toasts", () => {
  it("say pay link only when there is one", () => {
    expect(payToast("checkout")).toBe(PAY_LINK_TOAST);
    expect(payToast("invoice")).toBe(PAY_LINK_TOAST);
    expect(payToast("none")).toBe(BALANCE_EMAIL_TOAST);
    expect(BALANCE_EMAIL_TOAST).not.toMatch(/pay link/i);
  });

  it("name the email when sent, and explain the wait otherwise", () => {
    expect(sentToast("jordan.ellis@example.com")).toBe("Sent to jordan.ellis@example.com");
    expect(PAY_LINK_TOAST).toBe("Pay link sent. The files unlock when the balance is paid.");
  });
});
