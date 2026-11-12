import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Calendar panel states, server-rendered against fixture reads. */
type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null; loading?: boolean };
const reads: Record<string, Read> = {};
const readOpts: Array<{ op: string; args?: { query?: Record<string, unknown> }; opts?: { kinds?: string[]; pollMs?: number; enabled?: boolean } }> = [];
const queries: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null, args?: { query?: Record<string, unknown> }, opts?: { kinds?: string[]; pollMs?: number; enabled?: boolean }) => {
    if (op) readOpts.push({ op, args, opts });
    const r = (op && reads[op]) || { loading: true };
    return { data: r.data, error: r.error ?? null, loading: r.loading ?? (r.data === undefined && !r.error), refreshing: false, fetchedAt: r.data ? Date.now() - 12_000 : null, refresh: () => undefined };
  },
  useZuWrite: () => ({ run: async () => ({ ok: true, status: 200, limits: {} }), pending: false }),
  useZuFetch: () => async () => ({ data: undefined, error: null }),
  newIdem: () => "idem-test",
  useIdemFor: (fp: string) => `idem:${fp}`,
  clearZuCache: () => undefined,
}));

import { CrmProvider } from "./crm-context";
import { CrmCalendar } from "./crm-calendar";
import { CAL_OP } from "./calendar-ops";
import { DEV, MAYA } from "./crm-test-fixtures";

const html = () => renderToStaticMarkup(<CrmProvider><CrmCalendar /></CrmProvider>);
const at = (days: number) => {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  return new Date(d.getTime() + days * 86_400_000).toISOString();
};

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  for (const k of Object.keys(queries)) delete queries[k];
  readOpts.length = 0;
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
  reads[CAL_OP.members] = { data: { members: [{ id: "m1", user_id: "u1", full_name: "Ana Torres" }] } };
});

describe("Calendar panel", () => {
  it("loading", () => {
    expect(html()).toContain("Loading appointments");
  });

  it("error shows Zuops's reason with Retry", () => {
    reads[CAL_OP.bookings] = { error: { reason: "This key may not read bookings.", code: "scope_denied", status: 403 } };
    const out = html();
    expect(out).toContain("This key may not read bookings.");
    expect(out).toContain("Retry");
  });

  it("empty offers to book one", () => {
    reads[CAL_OP.bookings] = { data: { bookings: [] } };
    const out = html();
    expect(out).toContain("No appointments in this window");
    expect(out).toContain("Book one");
  });

  it("R3-I3: first open costs 3 requests: bookings, ONE leads page (limit 200) and members; no per-lead reads", () => {
    reads[CAL_OP.bookings] = { data: { bookings: [
      { id: "b1", lead_id: "lead-outside-page", title: "Mix review", starts_at: at(1), status: "scheduled" },
    ] } };
    reads[CAL_OP.leads] = { data: { leads: [MAYA], has_more: true } };
    const out = html();
    const live = readOpts.filter((r) => r.opts?.enabled !== false);
    expect(new Set(live.map((r) => r.op))).toEqual(new Set([CAL_OP.bookings, CAL_OP.leads, CAL_OP.members]));
    expect(live.find((r) => r.op === CAL_OP.leads)?.args?.query).toEqual({ limit: 200 });
    expect(live.some((r) => r.op === CAL_OP.lead)).toBe(false);
    expect(out).toContain("Lead e-page");
    for (const r of readOpts) expect(r.opts?.pollMs ?? 300_000).toBeGreaterThanOrEqual(300_000);
  });

  it("data: lead names, status words, past ones ask for an outcome (names from the leads page or the booking, else a placeholder)", () => {
    reads[CAL_OP.leads] = { data: { leads: [], has_more: false } };
    reads[CAL_OP.bookings] = { data: { bookings: [
      { id: "b1", lead_id: MAYA.id, lead_name: MAYA.full_name, title: "Mix review", starts_at: at(1), ends_at: at(1.0417), status: "scheduled", timezone: "America/Los_Angeles" },
      { id: "b2", lead_id: DEV.id, title: "Studio tour", starts_at: at(-2), ends_at: at(-1.97), status: "scheduled" },
      { id: "b3", lead_id: DEV.id, title: "Old call", starts_at: at(-3), status: "cancelled" },
    ] } };
    const out = html();
    expect(out).toContain("Maya Okafor");
    expect(out).toContain(`Lead ${DEV.id.slice(-6)}`);
    expect(out).toContain("Confirmed");
    expect(out).toContain("Cancelled");
    expect(out).toContain("No show");
    expect(out).not.toContain("—");
  });

  it("read only: Book is off and says why", () => {
    queries["crm:status"] = { keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: false };
    reads[CAL_OP.bookings] = { data: { bookings: [] } };
    expect(html()).toContain("Read only here. This deployment cannot change Zuops.");
  });
});
