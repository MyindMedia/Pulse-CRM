import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Leads panel states, server-rendered against fixture reads. The read hook is
   mocked by operation id; Convex queries feed the CRM status. */
type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null; loading?: boolean };
const reads: Record<string, Read> = {};
const queries: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null) => {
    const r = (op && reads[op]) || { loading: true };
    return { data: r.data, error: r.error ?? null, loading: r.loading ?? (r.data === undefined && !r.error), refreshing: false, fetchedAt: r.data ? Date.now() - 12_000 : null, refresh: () => undefined };
  },
  useZuWrite: () => ({ run: async () => ({ ok: true, status: 200, limits: {} }), pending: false }),
  useZuFetch: () => async () => ({ data: undefined, error: null }),
  newIdem: () => "idem-test",
  clearZuCache: () => undefined,
}));

import { CrmProvider } from "./crm-context";
import { CrmLeads, bySource, isFiltering, leadsQuery, newLeadBody, EMPTY_FILTERS } from "./crm-leads";
import { leadPatch, dollarsToCents } from "./crm-lead-sheet";
import { OP } from "./ops";
import { DEV, MAYA, STAGES } from "./crm-test-fixtures";

const html = () => renderToStaticMarkup(<CrmProvider><CrmLeads /></CrmProvider>);

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  for (const k of Object.keys(queries)) delete queries[k];
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
  reads[OP.stagesList] = { data: { stages: STAGES } };
  reads[OP.tagsList] = { data: { tags: [{ id: "t1", name: "Demo booked" }] } };
});

describe("Leads panel", () => {
  it("loading", () => {
    const out = html();
    expect(out).toContain("Loading leads");
    expect(out).toContain("Search leads");
  });

  it("error shows Zuops's reason with Retry", () => {
    reads[OP.leadsList] = { error: { reason: "This key may not read leads.", code: "scope_denied", status: 403 } };
    const out = html();
    expect(out).toContain("This key may not read leads.");
    expect(out).toContain("Retry");
  });

  it("empty", () => {
    reads[OP.leadsList] = { data: { leads: [], has_more: false, next_offset: null } };
    const out = html();
    expect(out).toContain("No leads yet");
  });

  it("data: rows with full contact, stage word, deal and paging", () => {
    reads[OP.leadsList] = { data: { leads: [MAYA, DEV], has_more: true, next_offset: 50 } };
    const out = html();
    expect(out).toContain("Maya Okafor");
    expect(out).toContain("maya@northline.example");
    expect(out).toContain("(213) 555-0142");
    expect(out).toContain("Booked");
    expect(out).toContain("$1,188");
    expect(out).toContain("Demo booked");
    expect(out).toContain("Dev Raman");
    expect(out).toContain("Showing 1 to 2");
    expect(out).toMatch(/Previous<\/button>/);
    expect(out).toContain("New lead");
    expect(out).not.toContain("—");
  });

  it("read only: New lead is off and says why", () => {
    queries["crm:status"] = { keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: false };
    reads[OP.leadsList] = { data: { leads: [MAYA], has_more: false, next_offset: null } };
    const out = html();
    expect(out).toContain("Read only here. This deployment cannot change Zuops.");
  });
});

describe("Leads logic", () => {
  it("builds the server query: limit 50, offset, search and filters; source stays local", () => {
    expect(leadsQuery(EMPTY_FILTERS, 0)).toEqual({ limit: 50 });
    const q = leadsQuery({ search: " maya ", status: "booked", stage: "booked", tag: "Demo booked", source: "instagram", existing: "customers" }, 50);
    expect(q).toMatchObject({ limit: 50, offset: 50, search: "maya", status: "booked", stage_key: "booked", tags: '["Demo booked"]', existing_customer: true });
    expect(q).not.toHaveProperty("source");
    expect(leadsQuery({ ...EMPTY_FILTERS, existing: "leads" }, 0).existing_customer).toBe(false);
    expect(bySource([MAYA, DEV], "instagram").map((l) => l.id)).toEqual(["lead-dev"]);
    expect(isFiltering(EMPTY_FILTERS)).toBe(false);
  });

  it("new lead: needs a name, email or phone; run_intake only when ticked", () => {
    const blank = { name: "", email: "", phone: "", inquiry: "", stage: "all", tags: "", runIntake: false };
    expect(newLeadBody(blank)).toEqual({ error: "Add a name, an email or a phone number." });
    expect(newLeadBody({ ...blank, email: "nope" })).toEqual({ error: "That email does not look right." });
    expect(newLeadBody({ ...blank, name: "Maya Okafor", email: "maya@northline.example", phone: "+12135550142", stage: "new", tags: "Demo, VIP" }))
      .toEqual({ body: { full_name: "Maya Okafor", email: "maya@northline.example", phone: "+12135550142", stage_key: "new", tags: ["Demo", "VIP"], run_intake: false } });
    expect(newLeadBody({ ...blank, name: "Maya", runIntake: true })).toEqual({ body: { full_name: "Maya", run_intake: true } });
  });

  it("lead PATCH carries only changed fields", () => {
    expect(leadPatch(MAYA, {})).toEqual({});
    expect(leadPatch(MAYA, { full_name: "Maya Okafor", email: "maya@northline.example", stage_key: "booked", deal: "1188" })).toEqual({});
    expect(leadPatch(MAYA, { stage_key: "won", deal: "1,250.50", addTags: ["VIP", "Demo booked"], removeTags: ["Demo booked", "Nope"] }))
      .toEqual({ stage_key: "won", deal_value_cents: 125050, add_tags: ["VIP"], remove_tags: ["Demo booked"] });
    expect(leadPatch(MAYA, { inquiry: "" })).toEqual({ inquiry: null });
    expect(leadPatch(MAYA, { custom: { studio_rooms: 3, consent: "" } })).toEqual({ custom_fields: { studio_rooms: 3 } });
    expect(dollarsToCents("abc")).toBeUndefined();
    expect(dollarsToCents("")).toBeNull();
  });
});
