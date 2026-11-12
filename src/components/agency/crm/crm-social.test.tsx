import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Social panel states, server-rendered against fixture reads. */
type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null; loading?: boolean };
const reads: Record<string, Read> = {};
const readOps: string[] = [];
const queries: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null, _args?: unknown, opts?: { enabled?: boolean }) => {
    if (op && opts?.enabled !== false) readOps.push(op);
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
import { CrmSocial } from "./crm-social";
import { SOCIAL_OP } from "./social-ops";
import { SOCIAL_OFF_REASON } from "./social-logic";

const html = () => renderToStaticMarkup(<CrmProvider><CrmSocial /></CrmProvider>);

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  for (const k of Object.keys(queries)) delete queries[k];
  readOps.length = 0;
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
});

describe("Social panel", () => {
  it("loading", () => {
    const out = html();
    expect(out).toContain("Connected accounts");
    expect(out).toContain("skeleton");
  });

  it("off for the account: a clear state, no broken panel", () => {
    reads[SOCIAL_OP.accounts] = { error: { reason: "Instagram & Messenger is not enabled for this account.", code: "not_enabled", status: 403 } };
    const out = html();
    expect(out).toContain("Instagram and Messenger is off");
    expect(out).toContain(SOCIAL_OFF_REASON.replace("&", "&amp;"));
    expect(out).not.toContain("Retry");
    expect(out).not.toContain("Who becomes a lead");
  });

  it("other errors show Zuops's reason with Retry", () => {
    reads[SOCIAL_OP.accounts] = { error: { reason: "Zuops is busy. Try again in a minute.", code: "rate_limited", status: 429 } };
    reads[SOCIAL_OP.settings] = { data: { lead_mode: "qualified" } };
    const out = html();
    expect(out).toContain("Zuops is busy. Try again in a minute.");
    expect(out).toContain("Retry");
  });

  it("empty: no accounts, connecting happens in Zuops", () => {
    reads[SOCIAL_OP.accounts] = { data: { accounts: [] } };
    reads[SOCIAL_OP.settings] = { data: { lead_mode: "qualified", dm_leads_to_move: 0 } };
    const out = html();
    expect(out).toContain("No accounts connected");
    expect(out).toContain("happens in the Zuops app");
  });

  it("data: accounts with status words and the lead mode explained", () => {
    reads[SOCIAL_OP.accounts] = { data: { accounts: [
      { id: "a1", platform: "instagram", name: "Northline Sound", username: "northline.example", enabled: true, ai_replies: true, status: "connected", live: true },
      { id: "a2", platform: "messenger", name: "Cedar Room Audio", enabled: false, ai_replies: false, status: "needs_reconnect", live: false, last_error: "Token expired" },
    ] } };
    reads[SOCIAL_OP.settings] = { data: { lead_mode: "qualified", dm_leads_to_move: 3 } };
    const out = html();
    expect(out).toContain("Northline Sound");
    expect(out).toContain("Connected");
    expect(out).toContain("Needs reconnect");
    expect(out).toContain("Token expired");
    expect(out).toContain("Qualified only (recommended)");
    expect(out).toContain("Everyone who sends a DM");
    expect(out).toContain("Zuops counts 3 right now.");
    expect(out).toContain("Count them");
    expect(out).not.toContain("—");
  });

  it("R3-I3: first open costs 2 requests: accounts and settings", () => {
    reads[SOCIAL_OP.accounts] = { data: { accounts: [] } };
    reads[SOCIAL_OP.settings] = { data: { lead_mode: "qualified" } };
    html();
    expect([...readOps].sort()).toEqual([SOCIAL_OP.accounts, SOCIAL_OP.settings].sort());
  });

  it("read only: settings writes are off and say why", () => {
    queries["crm:status"] = { keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: false };
    reads[SOCIAL_OP.accounts] = { data: { accounts: [] } };
    reads[SOCIAL_OP.settings] = { data: { lead_mode: "qualified" } };
    expect(html()).toContain("Read only here. This deployment cannot change Zuops.");
  });
});
