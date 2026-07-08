import { describe, it, expect } from "vitest";
import { filterInvoices, periodBounds, DEFAULT_INVOICE_FILTERS } from "./invoice-filter";

const now = new Date(2026, 6, 8); // Wed Jul 8 2026 (Q3)

function inv(over: Partial<Parameters<typeof filterInvoices>[0][number]> = {}) {
  return {
    number: "INV-1042",
    artistName: "Nova Reign",
    sessionTitle: "Golden Hour - mix revision",
    category: "Mixing",
    lineItems: [{ label: "Studio B - 3h session" }],
    _creationTime: new Date(2026, 6, 3).getTime(),
    ...over,
  };
}

describe("invoice filtering", () => {
  it("search matches invoice number, artist, session title, and line labels", () => {
    const rows = [inv(), inv({ number: "DEMO-77", artistName: "Aurora Sky", sessionTitle: null, lineItems: [{ label: "Mastering bundle" }] })];
    const f = (search: string) => filterInvoices(rows, { ...DEFAULT_INVOICE_FILTERS, search }, now);
    expect(f("1042").length).toBe(1);
    expect(f("nova").length).toBe(1);
    expect(f("golden hour").length).toBe(1);
    expect(f("mastering").length).toBe(1);
    expect(f("aurora").length).toBe(1);
    expect(f("nothing-here").length).toBe(0);
  });

  it("multi-word search requires every token to match (AND)", () => {
    const rows = [inv(), inv({ artistName: "Nova Reign", sessionTitle: "Tracking day" })];
    const out = filterInvoices(rows, { ...DEFAULT_INVOICE_FILTERS, search: "nova golden" }, now);
    expect(out.length).toBe(1);
    expect(out[0].sessionTitle).toContain("Golden");
  });

  it("category narrows to the derived category", () => {
    const rows = [inv(), inv({ category: "Recording" })];
    const out = filterInvoices(rows, { ...DEFAULT_INVOICE_FILTERS, category: "Recording" }, now);
    expect(out.length).toBe(1);
    expect(out[0].category).toBe("Recording");
  });

  it("named periods bound by issue date (calendar month/quarter/year)", () => {
    const rows = [
      inv({ _creationTime: new Date(2026, 6, 2).getTime() }), // this month (Jul)
      inv({ _creationTime: new Date(2026, 5, 20).getTime() }), // last month (Jun)
      inv({ _creationTime: new Date(2026, 0, 15).getTime() }), // this year (Jan)
      inv({ _creationTime: new Date(2025, 10, 1).getTime() }), // last year
    ];
    const by = (period: "month" | "last_month" | "quarter" | "year") =>
      filterInvoices(rows, { ...DEFAULT_INVOICE_FILTERS, period }, now).length;
    expect(by("month")).toBe(1);
    expect(by("last_month")).toBe(1);
    expect(by("quarter")).toBe(1); // Q3 = Jul-Sep
    expect(by("year")).toBe(3);
  });

  it("custom range is inclusive of both day bounds", () => {
    const rows = [inv({ _creationTime: new Date(2026, 6, 3, 14).getTime() })];
    const out = filterInvoices(
      rows,
      {
        ...DEFAULT_INVOICE_FILTERS,
        period: "custom",
        fromMs: new Date(2026, 6, 3).getTime(),
        toMs: new Date(2026, 6, 4).getTime(), // exclusive end = start of next day
      },
      now,
    );
    expect(out.length).toBe(1);
  });

  it("quarter bounds are calendar quarters", () => {
    const b = periodBounds("quarter", now)!;
    expect(b.start).toBe(new Date(2026, 6, 1).getTime());
    expect(b.end).toBe(new Date(2026, 9, 1).getTime());
  });
});
