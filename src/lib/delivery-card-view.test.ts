import { describe, it, expect } from "vitest";
import {
  BALANCE_EMAIL_TOAST,
  PAY_LINK_TOAST,
  deliveryCardView,
  payToast,
  sentToast,
  type CardView,
  type DeliveryStatus,
  type PayFacts,
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
    payFacts: null,
    onlinePay: "checkout",
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

const pf = (over: Partial<PayFacts> = {}): PayFacts => ({
  openInvoices: [],
  openInvoiceCount: 0,
  draftInvoices: 0,
  pricesHidden: false,
  cardsOn: true,
  ...over,
});
const waiting = (over: Partial<DeliveryStatus> = {}) =>
  deliveryCardView(
    status({ state: "awaiting_payment", onlinePay: "none", lastSentAt: EARLIER_TODAY, payFacts: pf(), ...over }),
    { canUpload: true, now: NOW },
  );
/** The one caution line the team card adds (the card table), or null. */
const todoLine = (view: CardView): string | null => {
  const caution = view.lines.find((l) => l.tone === "caution");
  return caution ? caution.parts.map((p) => p.text).join("") : null;
};

const OK_INVOICE = { number: "INV-0042", cents: 18000 };
const WRONG_INVOICE = { number: "INV-0042", cents: 30000 };

describe("deliveryCardView: the team card table (Addendum 5, R5-02)", () => {
  // One row per case. The first matching row wins; `facts` builds the payFacts
  // for that row, `over` the rest of the status.
  const ROWS: Array<{ row: number; facts: Partial<PayFacts>; over?: Partial<DeliveryStatus>; line: string }> = [
    {
      row: 1,
      facts: { openInvoices: [OK_INVOICE], openInvoiceCount: 1 },
      line: "Invoice INV-0042 for $180.00 is open. The files unlock when it is paid.",
    },
    {
      row: 2,
      facts: { openInvoices: [WRONG_INVOICE], openInvoiceCount: 1 },
      line: "Open invoices: INV-0042 ($300.00). $180.00 is owed. Leave one open invoice for exactly that amount so the files unlock when it is paid.",
    },
    {
      row: 2,
      facts: {
        openInvoices: [
          { number: "INV-0001", cents: 50000 },
          { number: "INV-0002", cents: 50000 },
        ],
        openInvoiceCount: 2,
      },
      over: { balanceCents: 50000 },
      line: "Open invoices: INV-0001 ($500.00), INV-0002 ($500.00). $500.00 is owed. Leave one open invoice for exactly that amount so the files unlock when it is paid.",
    },
    {
      row: 2,
      facts: {
        openInvoices: [1, 2, 3, 4, 5].map((i) => ({ number: `INV-000${i}`, cents: 100 })),
        openInvoiceCount: 7,
      },
      over: { balanceCents: 18000 },
      line: "Open invoices: INV-0001 ($1.00), INV-0002 ($1.00), INV-0003 ($1.00), INV-0004 ($1.00), INV-0005 ($1.00) and 2 more. $180.00 is owed. Leave one open invoice for exactly that amount so the files unlock when it is paid.",
    },
    {
      row: 3,
      facts: { draftInvoices: 1 },
      line: "A balance invoice is drafted but not sent. Send it so Jordan can pay.",
    },
    {
      row: 4,
      facts: { pricesHidden: true },
      over: { balanceCents: null },
      line: "Prices are hidden on this booking. Send Jordan an invoice to collect the balance.",
    },
    {
      row: 5,
      facts: {},
      line: "There is no online pay link for this balance. Send Jordan an invoice for it.",
    },
  ];

  for (const { row, facts, over, line } of ROWS) {
    it(`row ${row}: ${line.slice(0, 60)}...`, () => {
      const view = waiting({ payFacts: pf(facts), ...over });
      expect(todoLine(view)).toBe(line);
    });
  }

  it("with no first name the client fallback names the client", () => {
    expect(todoLine(waiting({ payFacts: pf({}), clientFirstName: "" }))).toBe(
      "There is no online pay link for this balance. Send the client an invoice for it.",
    );
  });

  it("precedence: an open invoice beats a draft, and a draft beats hidden prices", () => {
    expect(todoLine(waiting({ payFacts: pf({ openInvoices: [WRONG_INVOICE], openInvoiceCount: 1, draftInvoices: 1 }) }))).toMatch(/^Open invoices:/);
    expect(todoLine(waiting({ payFacts: pf({ draftInvoices: 1, pricesHidden: true }), balanceCents: null }))).toMatch(/^A balance invoice is drafted/);
  });

  it("a single open invoice whose amount differs from what is owed is row 2, never row 1", () => {
    expect(todoLine(waiting({ payFacts: pf({ openInvoices: [WRONG_INVOICE], openInvoiceCount: 1 }) }))).not.toContain("is open. The files unlock");
  });

  it("with an online pay target there is no extra line, whatever the facts", () => {
    for (const onlinePay of ["invoice", "checkout"] as const) {
      const view = waiting({ onlinePay, payFacts: pf({ openInvoices: [WRONG_INVOICE], openInvoiceCount: 1 }) });
      expect(view.lines.filter((l) => l.tone === "caution")).toEqual([]);
    }
  });

  it("the todo line is a caution line of its own, after the pay link line", () => {
    const view = waiting({ payFacts: pf({}) });
    expect(view.lines.length).toBe(2);
    expect(view.lines[1].tone).toBe("caution");
  });
});

describe("deliveryCardView: no money sight (payFacts null, balanceCents null)", () => {
  it("says only that a balance is owed: no amount, no digit followed by .00, no invoice number", () => {
    for (const onlinePay of ["none", "invoice", "checkout"]) {
      for (const canUpload of [true, false]) {
        for (const balanceDue of [true, false]) {
          const view = deliveryCardView(
            status({
              state: "awaiting_payment",
              onlinePay,
              balanceDue,
              balanceCents: null,
              payFacts: null,
              lastSentAt: EARLIER_TODAY,
              canRelease: false,
              canTurnOff: false,
            }),
            { canUpload, now: NOW },
          );
          for (const t of texts(view)) {
            expect(t).not.toContain("$");
            expect(t).not.toMatch(/\d\.00/);
            expect(t).not.toMatch(/INV-|invoice/i);
          }
        }
      }
    }
  });

  it("the owed line is the only balance line, with no todo line at all", () => {
    const view = waiting({ balanceCents: null, payFacts: null, canRelease: false, canTurnOff: false });
    expect(body(view)).toContain("A balance is still owed.");
    expect(todoLine(view)).toBeNull();
  });
});

describe("deliveryCardView: nothing owed while waiting (R5-03, V5-02)", () => {
  it("with a client email: the Resend line and Resend", () => {
    const view = waiting({ balanceDue: false, balanceCents: 0 });
    expect(texts({ ...view, pill: null, actions: [] })).toEqual(["Nothing is owed now. Tap Resend to send the files."]);
    expect(labels(view)).toEqual(["Resend", "Copy link", "Turn off link"]);
  });

  it("with no client email: names the missing email and does not offer Resend", () => {
    for (const balanceCents of [0, null]) {
      const view = waiting({ balanceDue: false, balanceCents, clientEmail: null });
      expect(texts({ ...view, pill: null, actions: [] })).toEqual([
        "Nothing is owed now, but there is no email on file. Add one for Jordan, then tap Resend.",
      ]);
      expect(labels(view)).not.toContain("Resend");
      expect(labels(view)).toEqual(["Copy link", "Turn off link"]);
    }
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
