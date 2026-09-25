import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { ReceiptsPanel } from "./receipts-panel";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    state.queries.push({ name, args });
    if (name === "receipts:list") return state.rows;
    if (name === "receipts:counts") return { fullyMatched: 3, processing: 2, needsAttention: 1 };
    return [];
  },
}));
vi.mock("./finance-history-sheet", () => ({ FinanceHistorySheet: () => null }));
vi.mock("./match-suggestions", () => ({ MatchSuggestions: () => null }));

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    _id: "receipt-1", fileName: "receipt.png", fileType: "image/png", url: "https://files.example/receipt-original.png",
    uploadedBy: "Studio owner", uploadedAt: Date.now(), status: "ready", vendor: "Receipt supplier",
    date: Date.UTC(2026, 8, 15), totalCents: 3910, taxCents: 260, cardLast4: null, confidence: 99, error: null,
    expense: null, transaction: null, matchingPending: false, needsAttention: true,
    attentionReason: "No confident expense or bank match. Review the suggestions.", ...overrides,
  };
}

function render(canEdit = true) {
  return renderToStaticMarkup(createElement(ReceiptsPanel, { canEdit }));
}

describe("receipt matching attention", () => {
  beforeEach(() => { state.rows = []; state.queries = []; });

  it("opens the server's attention queue and reports processing separately from fully matched", () => {
    const html = render();
    expect(state.queries).toContainEqual({ name: "receipts:list", args: { status: "needs_attention" } });
    expect(html).toContain("3 matched · 2 processing · 1 need attention");
    expect(html).toContain("No receipts need attention");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Needs attention/);
  });

  it.each([
    [null, null, "No confident expense or bank match. Review the suggestions."],
    [{ _id: "expense", category: "supplies", amountCents: 3910, vendor: "Supplier" }, null, "Expense matched; bank transaction still needs a match."],
    [null, { _id: "transaction", name: "Supplier", amountCents: 3910, date: Date.UTC(2026, 8, 15) }, "Bank transaction matched; an expense still needs a match."],
  ])("keeps an incomplete match visible without expanding the receipt", (expense, transaction, attentionReason) => {
    state.rows = [receipt({ expense, transaction, attentionReason })];
    const html = render();
    expect(html).toContain(attentionReason);
    expect(html).toContain("border-caution/50");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(">Read</span>");
  });

  it.each(["reading", "ready"])("labels %s work as processing rather than falsely unmatched", (status) => {
    state.rows = [receipt({ status, matchingPending: true, needsAttention: false, attentionReason: null })];
    const html = render();
    expect(html).toContain(status === "reading" ? ">Reading</span>" : ">Matching</span>");
    expect(html).toContain("You can leave this page");
    expect(html).not.toContain("border-caution/50");
  });

  it("marks a receipt fully matched only when the server has finished linking it", () => {
    state.rows = [receipt({
      expense: { _id: "expense", category: "supplies", amountCents: 3910, vendor: "Supplier" },
      transaction: { _id: "transaction", name: "Supplier", amountCents: 3910, date: Date.UTC(2026, 8, 15) },
      needsAttention: false, attentionReason: null,
    })];
    const html = render();
    expect(html).toContain(">Matched</span>");
    expect(html).toContain("In books");
    expect(html).toContain("Bank matched");
    expect(html).not.toContain("border-caution/50");
  });

  it("retains access to the original document while its details need review", () => {
    state.rows = [receipt({ status: "needs_review", attentionReason: "Check the receipt details before matching." })];
    const html = render(false);
    // The original opens in the in-app viewer, from its thumbnail or the button.
    expect(html).toContain('src="https://files.example/receipt-original.png"');
    expect(html).toContain('aria-label="View receipt: Receipt supplier"');
    expect(html).toContain("View receipt");
    expect(html).toContain("Check the receipt details before matching.");
    expect(html).not.toContain("Upload receipts");
    expect(html).not.toContain("Delete");
  });
});
