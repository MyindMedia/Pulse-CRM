import { describe, it, expect } from "vitest";
import { filterDeals, isFiltering, EMPTY_FILTER, type PipelineFilter } from "./filters";
import { STALE_AFTER_DAYS, type Opportunity } from "./constants";

/* Filtering narrows what is ON the board, never what a deal IS. */

const DAY = 86_400_000;
const deal = (over: Partial<Opportunity>): Opportunity => ({
  _id: Math.random().toString(36).slice(2),
  title: "Mixing - Aurora Sky",
  artistId: "a1",
  artistName: "Aurora Sky",
  artistType: "artist",
  stage: "inquiry",
  valueCents: 700_000,
  serviceType: "mixing",
  probability: 0.2,
  updatedAt: Date.now(),
  ...over,
});

const DEALS: Opportunity[] = [
  deal({ title: "Mixing - Aurora Sky", artistName: "Aurora Sky", serviceType: "mixing" }),
  deal({ title: "Mastering - Bishop Grey", artistName: "Bishop Grey", serviceType: "mastering" }),
  deal({
    title: "Rehearsal - Nova Reign", artistName: "Nova Reign", serviceType: "rehearsal",
    updatedAt: Date.now() - 30 * DAY,
  }),
];

const f = (over: Partial<PipelineFilter> = {}): PipelineFilter => ({ ...EMPTY_FILTER, ...over });

describe("filtering", () => {
  it("returns everything when nothing is set", () => {
    expect(filterDeals(DEALS, EMPTY_FILTER)).toHaveLength(3);
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
  });

  it("searches the deal title and the client name", () => {
    expect(filterDeals(DEALS, f({ query: "mastering" }))).toHaveLength(1);
    // Typing a client's name has to work even when it is not in the title.
    expect(filterDeals(DEALS, f({ query: "nova" }))).toHaveLength(1);
    expect(filterDeals(DEALS, f({ query: "  AURORA  " }))).toHaveLength(1);
  });

  it("filters by service, and treats several as OR", () => {
    expect(filterDeals(DEALS, f({ services: ["mixing"] }))).toHaveLength(1);
    expect(filterDeals(DEALS, f({ services: ["mixing", "mastering"] }))).toHaveLength(2);
  });

  it("filters by client", () => {
    expect(filterDeals(DEALS, f({ clients: ["Bishop Grey"] }))).toHaveLength(1);
  });

  it("finds exactly what has been dropped", () => {
    const stale = filterDeals(DEALS, f({ staleOnly: true }));
    expect(stale).toHaveLength(1);
    expect(stale[0].artistName).toBe("Nova Reign");
  });

  it("respects the same staleness threshold the cards use", () => {
    const justUnder = deal({ updatedAt: Date.now() - (STALE_AFTER_DAYS - 1) * DAY });
    const justOver = deal({ updatedAt: Date.now() - (STALE_AFTER_DAYS + 1) * DAY });
    expect(filterDeals([justUnder, justOver], f({ staleOnly: true }))).toHaveLength(1);
  });

  it("combines filters as AND, so each one narrows further", () => {
    expect(
      filterDeals(DEALS, f({ services: ["mixing"], clients: ["Bishop Grey"] })),
    ).toHaveLength(0);
    expect(
      filterDeals(DEALS, f({ services: ["mastering"], clients: ["Bishop Grey"] })),
    ).toHaveLength(1);
  });

  it("knows when it is filtering", () => {
    expect(isFiltering(f({ query: "x" }))).toBe(true);
    expect(isFiltering(f({ staleOnly: true }))).toBe(true);
    expect(isFiltering(f({ services: ["mixing"] }))).toBe(true);
    // Whitespace alone is not a search.
    expect(isFiltering(f({ query: "   " }))).toBe(false);
  });

  it("never mutates the deals it was handed", () => {
    const before = JSON.stringify(DEALS);
    filterDeals(DEALS, f({ query: "mixing", staleOnly: true }));
    expect(JSON.stringify(DEALS)).toBe(before);
  });
});
