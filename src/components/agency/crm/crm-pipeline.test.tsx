import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Pipeline logic and its server-rendered board, against fixture reads. */
type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null };
const reads: Record<string, Read> = {};
const queries: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null) => {
    const r = (op && reads[op]) || {};
    return { data: r.data, error: r.error ?? null, loading: r.data === undefined && !r.error, refreshing: false, held: false, fetchedAt: r.data ? Date.now() : null, startedAt: null, refresh: () => undefined };
  },
  useZuWrite: () => ({ run: async () => ({ ok: true, status: 200, limits: {} }), pending: false }),
  useZuFetch: () => async () => ({ data: undefined, error: null }),
  useIdemFor: () => "idem-test",
  stableStringify: (v: unknown) => JSON.stringify(v),
  newIdem: () => "idem-test",
  clearZuCache: () => undefined,
}));

import { CrmProvider } from "./crm-context";
import { CrmPipeline, applyOverrides, groupByStage, overrideSettled, unstagedNote, visibleStages, type ListFreshness } from "./crm-pipeline";
import { OP } from "./ops";
import { DEV, MAYA, STAGES } from "./crm-test-fixtures";
import type { Lead } from "./zu-types";

const PARTIAL: Lead[] = Array.from({ length: 11 }, (_, i) => ({
  id: `p${i}`, full_name: `Form ${i}`, status: "partial", stage: "partial", stage_key: null,
}));

const paged = (items: Lead[], over: Partial<ListFreshness> = {}) => ({
  items, truncated: false, complete: true, walkStartedAt: 1, headStartedAt: 1, headIds: items.map((l) => l.id), ...over,
});

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
  reads[OP.stagesList] = { data: { stages: STAGES } };
});

describe("F-V6 leads with no stage", () => {
  it("F-V6: unfinished form leads are counted, not dropped, and point to Leads filtered by their status", () => {
    const cols = visibleStages(STAGES);
    const lostLead: Lead = { ...DEV, id: "lead-lost", stage: "lost" };
    const g = groupByStage([MAYA, DEV, lostLead, ...PARTIAL], cols, STAGES);
    expect(g.columns.booked.map((l) => l.id)).toEqual(["lead-maya"]);
    expect(g.hidden).toBe(1);
    expect(g.unstaged).toHaveLength(11);
    expect(unstagedNote(g.unstaged)).toEqual({ text: "11 leads are not in a stage (unfinished or not yet staged).", status: "partial" });
    expect(unstagedNote([...PARTIAL.slice(0, 1), { ...DEV, id: "x", stage: null, status: "new" }])?.status).toBeUndefined();
    expect(unstagedNote([])).toBeNull();
  });

  it("F-V6: the board shows the quiet line with a link to Leads", () => {
    reads[OP.leadsList] = { data: paged([MAYA, DEV, ...PARTIAL]) };
    const out = renderToStaticMarkup(<CrmProvider><CrmPipeline /></CrmProvider>);
    expect(out).toContain("11 leads are not in a stage (unfinished or not yet staged).");
    expect(out).toContain("See them in Leads.");
  });
});

describe("F-U13 Move to never writes on change", () => {
  it("F-U13: each card has a stage select and a separate Move button, off until another stage is picked", () => {
    reads[OP.leadsList] = { data: paged([MAYA]) };
    const out = renderToStaticMarkup(<CrmProvider><CrmPipeline /></CrmProvider>);
    expect(out).toMatch(/<select[^>]*id="move-lead-maya"/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Move Maya Okafor"[^>]*>Move<\/button>/);
  });
});

describe("R3-U6 pipeline copy", () => {
  it("R3-U6: counts are plural only when they should be, and the automation note is shown", () => {
    reads[OP.leadsList] = { data: paged([MAYA, DEV]) };
    const out = renderToStaticMarkup(<CrmProvider><CrmPipeline /></CrmProvider>);
    expect(out).toContain("1 lead · $1,188");
    expect(out).toContain("0 leads · $0");
    expect(out).not.toMatch(/\b1 leads\b/);
    expect(out).toContain("Moving a lead can start any automation you set on that stage in Zuops.");
    expect(unstagedNote(PARTIAL.slice(0, 1))?.text).toBe("1 lead is not in a stage (unfinished or not yet staged).");
  });

  it("R3-U1: the card's controls carry focus keys, so focus can follow a card into its new column", () => {
    reads[OP.leadsList] = { data: paged([MAYA]) };
    const out = renderToStaticMarkup(<CrmProvider><CrmPipeline /></CrmProvider>);
    expect(out).toContain('data-focus-key="card-move:lead-maya"');
    expect(out).toContain('data-focus-key="card-open:lead-maya"');
  });
});

describe("F-U12 optimistic moves", () => {
  const o = { stage: "won", at: 1_000 };
  it("F-U12: a poll that STARTED before the move cannot put the card back", () => {
    const before: ListFreshness = { walkStartedAt: 500, headStartedAt: 900, headIds: [MAYA.id] };
    expect(overrideSettled(MAYA, o, before)).toBe(false);
    expect(applyOverrides([MAYA], { [MAYA.id]: o }, before)[0].stage).toBe("won");
  });

  it("F-U12: a fetch that started after the move settles it, page 1 only for the rows it returned", () => {
    expect(overrideSettled(MAYA, o, { walkStartedAt: 500, headStartedAt: 1_500, headIds: [MAYA.id] })).toBe(true);
    expect(overrideSettled(MAYA, o, { walkStartedAt: 500, headStartedAt: 1_500, headIds: ["other"] })).toBe(false);
    expect(overrideSettled(MAYA, o, { walkStartedAt: 1_500, headStartedAt: 1_500, headIds: [] })).toBe(true);
    expect(overrideSettled({ ...MAYA, stage: "won" }, o, null)).toBe(true); // the data already agrees
  });
});
