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
    noShow: false,
    openInvoice: null,
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
    for (const reason of [...Object.keys(REASONS), "open_invoice_wrong_amount", "nothing_owed", null] as DeliveryStatus["onlinePayReason"][]) {
      // P4-01: also with an open invoice the server would never send them
      // (defensive), matching or not.
      for (const openInvoice of [null, { number: "INV-0042", cents: 18000 }, { number: "INV-0042", cents: 30000 }]) {
        const view = waiting({ onlinePayReason: reason, openInvoice, balanceCents: null, canRelease: false, canTurnOff: false });
        expect(body(view)).toContain("A balance is still owed.");
        for (const line of ALL_REASON_LINES) expect(body(view)).not.toContain(line);
        expect(body(view)).not.toContain("is open");
        expect(body(view)).not.toContain("Void or correct");
        for (const t of texts(view)) {
          expect(t).not.toContain("$");
          expect(t).not.toMatch(/\d\.00/);
          expect(t).not.toContain("INV-0042");
        }
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

describe("deliveryCardView: an open invoice with the wrong amount (R4-01)", () => {
  const OPEN = { number: "INV-0042", cents: 30000 };
  const LINE = "Invoice INV-0042 is open for $300.00, but $180.00 is owed. Void or correct it so Jordan can pay online.";
  const NO_LINK_LINE = "There is no online pay link for this balance. Send Jordan an invoice for it.";
  const waiting = (over: Partial<DeliveryStatus>) =>
    deliveryCardView(
      status({ state: "awaiting_payment", onlinePay: "none", onlinePayReason: "open_invoice_wrong_amount", openInvoice: OPEN, lastSentAt: EARLIER_TODAY, ...over }),
      { canUpload: true, now: NOW },
    );

  it("a caller with money sight is told to void or correct it, naming the invoice and both amounts", () => {
    const view = waiting({});
    expect(texts(view)).toContain(LINE);
    expect(body(view)).toContain("$180.00 is still owed.");
    expect(view.lines.at(-1)).toEqual({ parts: [{ text: LINE }], tone: "caution" });
  });

  it("never tells staff to send another invoice when one is already open", () => {
    expect(body(waiting({}))).not.toMatch(/send .* an invoice/i);
    expect(body(waiting({}))).not.toContain(NO_LINK_LINE);
  });

  it("uses the client fallback with no first name", () => {
    expect(texts(waiting({ clientFirstName: "" }))).toContain(
      "Invoice INV-0042 is open for $300.00, but $180.00 is owed. Void or correct it so the client can pay online.",
    );
  });

  it("the send-an-invoice line stays only for the no-open-invoice reason", () => {
    const view = waiting({ onlinePayReason: "amount_mismatch", openInvoice: null });
    expect(texts(view)).toContain(NO_LINK_LINE);
    expect(body(view)).not.toContain("Void or correct");
  });

  it("without money sight (balanceCents or openInvoice null) no string has a dollar sign or an invoice number", () => {
    const combos: Partial<DeliveryStatus>[] = [
      { balanceCents: null, openInvoice: null },
      { balanceCents: null, openInvoice: OPEN }, // defensive: the server never sends this
      { balanceCents: 18000, openInvoice: null }, // money sight but no open invoice to name
    ];
    for (const combo of combos) {
      for (const canUpload of [true, false]) {
        const view = deliveryCardView(
          status({ state: "awaiting_payment", onlinePay: "none", onlinePayReason: "open_invoice_wrong_amount", lastSentAt: EARLIER_TODAY, ...combo }),
          { canUpload, now: NOW },
        );
        for (const t of texts(view)) {
          expect(t).not.toContain("INV-0042");
          expect(t).not.toContain("Void or correct");
          // P4-01: nor the line for an open invoice that is what is owed.
          expect(t).not.toContain("is open.");
          if (combo.balanceCents === null) {
            expect(t).not.toContain("$");
            expect(t).not.toMatch(/\d\.00/);
          }
        }
        if (combo.balanceCents === null) expect(body(view)).toContain("A balance is still owed.");
      }
    }
  });
});

describe("deliveryCardView: an open invoice decides the line first (P4-01)", () => {
  const REASONS = ["open_invoice_wrong_amount", "prices_hidden", "amount_mismatch", "invoice_not_sent"] as const;
  const PAY_IT = "Invoice INV-0042 for $180.00 is open. The files unlock when it is paid.";
  const VOID = "Invoice INV-0042 is open for $300.00, but $180.00 is owed. Void or correct it so Jordan can pay online.";
  const SEND = /send .*invoice/i;
  const waiting = (over: Partial<DeliveryStatus>) =>
    deliveryCardView(status({ state: "awaiting_payment", onlinePay: "none", lastSentAt: EARLIER_TODAY, ...over }), { canUpload: true, now: NOW });

  it("cards off with an open invoice for exactly what is owed: pay that invoice, never 'open for $180.00, but $180.00 is owed'", () => {
    const view = waiting({ onlinePayReason: "open_invoice_wrong_amount", openInvoice: { number: "INV-0042", cents: 18000 } });
    expect(view.lines.at(-1)).toEqual({ parts: [{ text: PAY_IT }], tone: "caution" });
    expect(body(view)).not.toContain("but $180.00 is owed");
    expect(body(view)).not.toContain("Void or correct");
    expect(body(view)).toContain("$180.00 is still owed.");
  });

  it("hidden prices with an open invoice: pay that invoice, never 'Send an invoice'", () => {
    const view = waiting({ onlinePayReason: "prices_hidden", openInvoice: { number: "INV-0042", cents: 18000 } });
    expect(view.lines.at(-1)).toEqual({ parts: [{ text: PAY_IT }], tone: "caution" });
    expect(body(view)).not.toMatch(SEND);
    expect(body(view)).not.toContain("Prices are hidden");
  });

  it("hidden prices with an open invoice for another amount: the void or correct line", () => {
    const view = waiting({ onlinePayReason: "prices_hidden", openInvoice: { number: "INV-0042", cents: 30000 } });
    expect(view.lines.at(-1)).toEqual({ parts: [{ text: VOID }], tone: "caution" });
    expect(body(view)).not.toMatch(SEND);
  });

  it("whatever the reason, the open invoice decides: same amount pays it, another amount is voided or corrected", () => {
    for (const reason of REASONS) {
      const same = waiting({ onlinePayReason: reason, openInvoice: { number: "INV-0042", cents: 18000 } });
      expect(texts(same), reason).toContain(PAY_IT);
      expect(body(same), reason).not.toMatch(SEND);
      const other = waiting({ onlinePayReason: reason, openInvoice: { number: "INV-0042", cents: 30000 } });
      expect(texts(other), reason).toContain(VOID);
      expect(body(other), reason).not.toMatch(SEND);
      expect(body(other), reason).not.toContain(PAY_IT);
    }
  });

  it("no open invoice: the line for the reason, as before", () => {
    expect(texts(waiting({ onlinePayReason: "prices_hidden", openInvoice: null }))).toContain(
      "Prices are hidden on this booking. Send Jordan an invoice to collect the balance.",
    );
    expect(texts(waiting({ onlinePayReason: "amount_mismatch", openInvoice: null }))).toContain(
      "There is no online pay link for this balance. Send Jordan an invoice for it.",
    );
    expect(texts(waiting({ onlinePayReason: "invoice_not_sent", openInvoice: null }))).toContain(
      "Send the balance invoice so Jordan can pay online.",
    );
    expect(body(waiting({ onlinePayReason: "open_invoice_wrong_amount", openInvoice: null }))).not.toContain("is open");
  });

  it("with an online pay target there is no extra line, open invoice or not", () => {
    const view = waiting({ onlinePay: "invoice", onlinePayReason: null, openInvoice: { number: "INV-0042", cents: 18000 } });
    expect(body(view)).not.toContain(PAY_IT);
    expect(view.lines.some((l) => l.tone === "caution")).toBe(false);
  });

  it("without money sight: only that a balance is owed, with no invoice number and no amount", () => {
    for (const reason of REASONS) {
      for (const cents of [18000, 30000]) {
        for (const canUpload of [true, false]) {
          const view = deliveryCardView(
            status({ state: "awaiting_payment", onlinePay: "none", onlinePayReason: reason, openInvoice: { number: "INV-0042", cents }, balanceCents: null, lastSentAt: EARLIER_TODAY }),
            { canUpload, now: NOW },
          );
          expect(body(view)).toContain("A balance is still owed.");
          expect(view.lines.some((l) => l.tone === "caution")).toBe(false);
          for (const t of texts(view)) {
            expect(t).not.toContain("$");
            expect(t).not.toContain("INV-0042");
            expect(t).not.toMatch(/\d\.00/);
          }
        }
      }
    }
  });
});

describe("deliveryCardView: a no-show booking (R4-02)", () => {
  const LINE = "This booking was a no-show, so there is nothing to deliver.";

  it("says there is nothing to deliver, in every state, with Ready disabled like a cancelled booking", () => {
    for (const state of STATES) {
      const view = deliveryCardView(status({ state, noShow: true, canMarkReady: false, canRelease: false }), { canUpload: true, now: NOW });
      expect(body(view)).toBe(LINE);
      expect(view.pill).toBeNull();
      expect(view.actions).toEqual([expect.objectContaining({ key: "ready", disabled: true })]);
    }
  });

  it("offers nothing to a caller who cannot upload, and shows no amount", () => {
    const view = deliveryCardView(status({ state: "awaiting_payment", noShow: true, balanceCents: null }), { canUpload: false, now: NOW });
    expect(view.actions).toEqual([]);
    for (const t of texts(view)) expect(t).not.toContain("$");
  });

  it("the same buttons as a cancelled booking", () => {
    const a = deliveryCardView(status({ cancelled: true }), { canUpload: true, now: NOW });
    const b = deliveryCardView(status({ noShow: true }), { canUpload: true, now: NOW });
    expect(b.actions).toEqual(a.actions);
    expect(b.pill).toEqual(a.pill);
    expect(body(a)).toBe("This booking was cancelled, so there is nothing to deliver.");
  });
});
