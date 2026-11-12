import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Dashboard states, server-rendered against fixture reads (eval U-01, U-07). */
type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null };
const reads: Record<string, Read> = {};
const requested: string[] = [];
const queries: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null) => {
    if (op) requested.push(op);
    const r = (op && reads[op]) || {};
    return { data: r.data, error: r.error ?? null, loading: r.data === undefined && !r.error, refreshing: false, fetchedAt: r.data ? 1 : null, refresh: () => undefined };
  },
  useZuWrite: () => ({ run: async () => ({ ok: true, status: 200, limits: {} }), pending: false }),
  newIdem: () => "idem-test",
}));

import { CrmProvider } from "./crm-context";
import { CrmDashboard, deltaOf, reachRows, setupFindings, speed } from "./crm-dashboard";
import { OP } from "./ops";
import { HEALTH, OVERVIEW, SETUP } from "./crm-test-fixtures";

const html = () => renderToStaticMarkup(<CrmProvider><CrmDashboard /></CrmProvider>);

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  requested.length = 0;
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
});

describe("Dashboard panel", () => {
  it("opening it reads three operations; credits and limits wait until asked (P-02)", () => {
    html();
    expect(new Set(requested)).toEqual(new Set([OP.overview, OP.healthScore, OP.setupStatus]));
  });

  it("loading", () => {
    const out = html();
    expect(out).toContain("Loading overview");
    expect(out).toContain("Health score");
    expect(out).toContain("Setup checklist");
  });

  it("error shows Zuops's reason", () => {
    reads[OP.overview] = { error: { reason: "Zuops is busy. Try again in a minute.", status: 503 } };
    const out = html();
    expect(out).toContain("Zuops is busy. Try again in a minute.");
    expect(out).toContain("Retry");
  });

  it("empty window", () => {
    reads[OP.overview] = { data: { window: { days: 30 }, stats: { leads: 0, prev_leads: 0, stage_reach: { total: 0, reached: {} } } } };
    reads[OP.healthScore] = { data: { score: 0, grade: "Dormant", factors: [], actions: [] } };
    reads[OP.setupStatus] = { data: { findings: [] } };
    const out = html();
    expect(out).toContain("No leads in the last 30 days");
    expect(out).toContain("Nothing missing");
  });

  it("data: tiles with the previous window, reach, health factors and actions, the checklist", () => {
    reads[OP.overview] = { data: OVERVIEW };
    reads[OP.healthScore] = { data: HEALTH };
    reads[OP.setupStatus] = { data: SETUP };
    const out = html();
    expect(out).toContain("New leads · 30 d");
    expect(out).toContain("Prior 30 days: 2");
    expect(out).toContain("400%");
    expect(out).toContain("5 s");
    expect(out).toContain("Needs attention");
    expect(out).toContain("Speed to lead");
    expect(out).toContain("25/25");
    expect(out).toContain("Not measured yet");
    expect(out).toContain("Reply to 2 waiting leads");
    expect(out).toContain("+8 points");
    expect(out).toContain("The AI agent has no FAQ or business description.");
    expect(out).toContain("Needs a Full access key");
    expect(out).toContain("Done in the Zuops app");
    expect(out).toContain("Credits and today");
    expect(out).not.toContain("—");
  });
});

describe("Setup checklist and the Full access key", () => {
  it("shows the Full access note only while there is no Full access key", () => {
    reads[OP.overview] = { data: OVERVIEW };
    reads[OP.healthScore] = { data: HEALTH };
    reads[OP.setupStatus] = { data: SETUP };
    expect(html()).toContain("Needs a Full access key");
    queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: true, webhookConfigured: true };
    const out = html();
    expect(out).not.toContain("Needs a Full access key");
    expect(out).toContain("Fix it in the Settings tab");
    expect(out).toContain("Done in the Zuops app");
  });
});

describe("Dashboard logic", () => {
  it("deltas, speed and reach", () => {
    expect(deltaOf(10, 2)).toBe(4);
    expect(deltaOf(1, 0)).toBeUndefined();
    expect(speed(0.08)).toBe("5 s");
    expect(speed(12)).toBe("12 min");
    expect(speed(null)).toBe("–");
    expect(reachRows(OVERVIEW.stats!.stage_reach).map((r) => r.label)).toEqual(["New", "Contacted", "Booked"]);
  });

  it("setup findings: most serious first, admin fixes and app-only ones flagged", () => {
    const f = setupFindings(SETUP);
    expect(f[0]).toMatchObject({ severity: "medium", issue: "The AI agent has no FAQ or business description.", fix: "Fixed by POST /v1/knowledge-base" });
    expect(f.find((x) => x.issue.startsWith("No client user"))?.needsAdmin).toBe(true);
    expect(f.find((x) => x.issue.startsWith("No website widget"))?.inAppOnly).toBe(true);
    expect(f.find((x) => x.issue.startsWith("Missed-call"))).toMatchObject({ needsAdmin: false, fix: "PATCH /v1/ai-texting with missed_call_text: true" });
    expect(setupFindings(null)).toEqual([]);
  });
});
