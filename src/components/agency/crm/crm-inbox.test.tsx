import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Inbox panel states, server-rendered against fixture reads (no clicks: the test
   runtime has no DOM). The read hook is mocked by operation id. */
type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null; loading?: boolean };
const reads: Record<string, Read> = {};
const readOpts: Array<{ op: string; opts?: { kinds?: string[]; pollMs?: number } }> = [];
const queries: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null, _args?: unknown, opts?: { kinds?: string[]; pollMs?: number }) => {
    if (op) readOpts.push({ op, opts });
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
import { CrmInbox } from "./crm-inbox";
import { INBOX_OP } from "./inbox-ops";
import { MAYA, DEV } from "./crm-test-fixtures";

const html = (openLeadId?: string) => renderToStaticMarkup(<CrmProvider><CrmInbox openLeadId={openLeadId} /></CrmProvider>);

const CONVS = [
  { lead_id: MAYA.id, name: MAYA.full_name, phone: MAYA.phone, email: MAYA.email, unread: true, unread_count: 2, channel: "sms",
    last_message: { channel: "sms", direction: "inbound", body: "Can we move the demo to Friday?", created_at: "2026-11-11T17:00:00Z" }, last_activity_at: "2026-11-11T17:00:00Z" },
  { lead_id: DEV.id, name: DEV.full_name, channel: "instagram", ai: { paused: true },
    last_message: { channel: "instagram", direction: "outbound", body: "Thanks for writing in", created_at: "2026-11-10T17:00:00Z" }, last_activity_at: "2026-11-10T17:00:00Z" },
];

beforeEach(() => {
  for (const k of Object.keys(reads)) delete reads[k];
  for (const k of Object.keys(queries)) delete queries[k];
  readOpts.length = 0;
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
  reads[INBOX_OP.scheduled] = { data: { scheduled_messages: [] } };
  reads[INBOX_OP.suggestions] = { data: { suggestions: [] } };
});

describe("Inbox panel", () => {
  it("loading", () => {
    const out = html();
    expect(out).toContain("Loading conversations");
    expect(out).toContain("Search conversations");
  });

  it("error shows Zuops's reason with Retry", () => {
    reads[INBOX_OP.conversations] = { error: { reason: "This key may not read conversations.", code: "scope_denied", status: 403 } };
    const out = html();
    expect(out).toContain("This key may not read conversations.");
    expect(out).toContain("Retry");
  });

  it("empty", () => {
    reads[INBOX_OP.conversations] = { data: { conversations: [], has_more: false, counts: { open: 0, unread: 0, archived: 0 } } };
    expect(html()).toContain("No conversations yet");
  });

  it("data: rows with name, preview, unread and filter counts", () => {
    reads[INBOX_OP.conversations] = { data: { conversations: CONVS, has_more: true, next_cursor: "c2", counts: { open: 12, unread: 2, archived: 30 } } };
    const out = html();
    expect(out).toContain("Maya Okafor");
    expect(out).toContain("Can we move the demo to Friday?");
    expect(out).toContain("Dev Raman");
    expect(out).toContain("You: Thanks for writing in");
    expect(out).toContain("Unread");
    expect(out).toContain("12");
    expect(out).toContain("Load more");
    expect(out).not.toContain("—");
  });

  it("opening a lead shows its thread, oldest first, with the composer", () => {
    reads[INBOX_OP.conversations] = { data: { conversations: CONVS, has_more: false, counts: { open: 2, unread: 1, archived: 0 } } };
    reads[INBOX_OP.thread] = { data: { lead: { id: MAYA.id, full_name: MAYA.full_name }, messages: [
      { id: "e2", event_type: "sms_inbound", body: "Can we move the demo to Friday?", created_at: "2026-11-11T17:00:00Z" },
      { id: "e1", event_type: "sms_outbound", body: "Your demo is Thursday at 2.", created_at: "2026-11-10T17:00:00Z" },
    ] } };
    reads[INBOX_OP.lead] = { data: { lead: MAYA } };
    reads[INBOX_OP.limits] = { data: { daily_unique_contact_cap: 50, unique_contacts_remaining: 41 } };
    reads[INBOX_OP.phoneNumbers] = { data: { phone_numbers: [] } };
    const out = html(MAYA.id);
    const a = out.indexOf("Your demo is Thursday at 2.");
    const b = out.lastIndexOf("Can we move the demo to Friday?");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(out).toContain("Mark unread");
    expect(out).toContain("Send");
  });

  it("R3-I3: first open costs 3 requests: conversations, scheduled and suggestions", () => {
    reads[INBOX_OP.conversations] = { data: { conversations: CONVS, has_more: false, counts: { open: 2, unread: 1, archived: 0 } } };
    html();
    expect(readOpts.map((r) => r.op).sort()).toEqual([INBOX_OP.conversations, INBOX_OP.scheduled, INBOX_OP.suggestions].sort());
  });

  it("F-U3: with a thread open, a message signal refetches only the list and the open thread", () => {
    reads[INBOX_OP.conversations] = { data: { conversations: CONVS, has_more: false, counts: { open: 2, unread: 1, archived: 0 } } };
    reads[INBOX_OP.thread] = { data: { messages: [] } };
    reads[INBOX_OP.lead] = { data: { lead: MAYA } };
    html(MAYA.id);
    const onMessage = new Set(readOpts.filter((r) => r.opts?.kinds?.includes("message")).map((r) => r.op));
    expect(onMessage).toEqual(new Set([INBOX_OP.conversations, INBOX_OP.thread]));
    for (const op of [INBOX_OP.scheduled, INBOX_OP.suggestions, INBOX_OP.limits]) {
      for (const r of readOpts.filter((x) => x.op === op)) expect(r.opts?.pollMs).toBeGreaterThanOrEqual(300_000);
    }
  });

  it("F-U2: the Text composer says Pulse cannot see text opt-outs", () => {
    reads[INBOX_OP.conversations] = { data: { conversations: CONVS, has_more: false, counts: { open: 2, unread: 1, archived: 0 } } };
    reads[INBOX_OP.thread] = { data: { messages: [] } };
    reads[INBOX_OP.lead] = { data: { lead: MAYA } };
    expect(html(MAYA.id)).toContain("Pulse cannot see text opt-outs. Zuops blocks a text to anyone who replied STOP or is marked do not contact.");
  });

  it("read only: writing buttons are off and say why", () => {
    queries["crm:status"] = { keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: false };
    reads[INBOX_OP.conversations] = { data: { conversations: CONVS, has_more: false, counts: { open: 2, unread: 1, archived: 0 } } };
    reads[INBOX_OP.thread] = { data: { messages: [] } };
    reads[INBOX_OP.lead] = { data: { lead: MAYA } };
    const out = html(MAYA.id);
    expect(out).toContain("Read only here. This deployment cannot change Zuops.");
  });
});
