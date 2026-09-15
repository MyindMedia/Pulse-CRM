import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { MatchSuggestions } from "./match-suggestions";

const state = vi.hoisted(() => ({
  effects: [] as Array<() => void>,
  shown: vi.fn(async () => ({ recorded: 0 })),
  loading: false,
  count: 6,
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  // Run the component's real effect body after its markup has rendered.
  useEffect: (effect: () => void) => { state.effects.push(effect); },
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.loading ? undefined : Array.from({ length: state.count }, (_, i) => ({
    kind: "expense", id: `expense-${i}`, label: `Expense ${i}`, amountCents: 2000,
    dateMs: Date.parse("2026-09-02T00:00:00Z"), score: 100, reasons: ["amount matches"], alreadyMatched: false,
    displayVersion: `version-${i}`,
  })),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference) === "reconcile:recordSuggestionsShown" ? state.shown : vi.fn(),
}));

describe("displayed match suggestion audit", () => {
  beforeEach(() => {
    state.effects = [];
    state.shown.mockClear();
    state.loading = false;
    state.count = 6;
  });

  it.each([true, false])("reports only the rendered subset for compact=%s", async (compact) => {
    const html = renderToStaticMarkup(createElement(MatchSuggestions, { kind: "receipt", id: "receipt", canEdit: true, compact }));
    for (const effect of state.effects) effect();
    const count = compact ? 2 : 5;
    expect(state.shown).toHaveBeenCalledWith({
      kind: "receipt", id: "receipt",
      candidates: Array.from({ length: count }, (_, i) => ({ kind: "expense", id: `expense-${i}`, displayVersion: `version-${i}` })),
    });
    expect(html).toContain(`Expense ${count - 1}`);
    expect(html).not.toContain(`Expense ${count}`);
  });

  it("does not send display events while loading or for an empty result", () => {
    for (const loading of [true, false]) {
      state.loading = loading;
      state.count = 0;
      renderToStaticMarkup(createElement(MatchSuggestions, { kind: "receipt", id: "receipt", canEdit: true }));
    }
    for (const effect of state.effects) effect();
    expect(state.shown).not.toHaveBeenCalled();
  });
});
