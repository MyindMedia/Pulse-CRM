import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BankingPage from "@/app/(app)/banking/page";

const state = vi.hoisted(() => ({ query: "", paginate: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock("convex-helpers/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => {
    state.paginate(...args);
    return { results: [], status: "Exhausted", loadMore: vi.fn() };
  },
}));

describe("banking report links", () => {
  beforeEach(() => { state.query = ""; state.paginate.mockClear(); });

  it("opens precisely the report period and attention filter", () => {
    const start = Date.parse("2025-09-01T00:00:00Z");
    const end = Date.parse("2025-10-01T00:00:00Z");
    state.query = `start=${start}&end=${end}&filter=attention`;
    renderToStaticMarkup(createElement(BankingPage));
    expect(state.paginate.mock.calls[0][1]).toMatchObject({ start, end, filter: "attention" });
  });

  it("falls back to the default period and filter for a malformed report link", () => {
    state.query = "start=NaN&end=10&filter=unknown";
    renderToStaticMarkup(createElement(BankingPage));
    const args = state.paginate.mock.calls[0][1] as { start: number; end: number; filter: string };
    expect(Number.isFinite(args.start)).toBe(true);
    expect(args.end - args.start).toBe(90 * 86_400_000);
    expect(args.filter).toBe("attention");
  });
});
