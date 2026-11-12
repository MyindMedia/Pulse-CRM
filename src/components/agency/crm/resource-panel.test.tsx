import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* The generic resource panel, server-rendered against fixture reads (not a
   browser check). The read hook is mocked by operation id; ConfirmDialog is
   wrapped so the test sees every confirm the panel renders and can press it. */

type Read = { data?: unknown; error?: { reason: string; code?: string; status: number } | null; loading?: boolean };
const reads: Record<string, Read> = {};
const queries: Record<string, unknown> = {};
const runs: Array<{ op: string; args: Record<string, unknown> }> = [];
type ConfirmProps = { title: string; body: React.ReactNode; confirmLabel: string; onConfirm: (g: { readonly confirm: true }) => unknown };
const confirms: ConfirmProps[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null) => {
    const r = (op && reads[op]) || { loading: op !== null };
    return { data: r.data, error: r.error ?? null, loading: r.loading ?? (r.data === undefined && !r.error), refreshing: false, fetchedAt: r.data ? Date.now() - 5_000 : null, refresh: () => undefined };
  },
  useZuWrite: () => ({ run: async (op: string, args: Record<string, unknown>) => { runs.push({ op, args }); return { ok: true, status: 200, limits: {} }; }, pending: false }),
  useZuFetch: () => async () => ({ data: undefined, error: null }),
  newIdem: () => "idem-test",
  stableStringify: (x: unknown) => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)),
  useIdemFor: (fp: string) => `idem:${fp}`,
  clearZuCache: () => undefined,
}));
vi.mock("./crm-ui", async (orig) => {
  const real = await orig<typeof import("./crm-ui")>();
  return {
    ...real,
    ConfirmDialog: (p: ConfirmProps) => {
      confirms.push(p);
      return <div data-confirm="">{p.title} | {p.body} | {p.confirmLabel}</div>;
    },
  };
});

import { ZU_OPS } from "@convex/crm/ops.generated";
import { CrmProvider } from "./crm-context";
import { RESOURCES, type ActionDef, type ResourceDef } from "./resource-config";
import { READ_ACTION_OPS, ResourcePanel, RowActions } from "./resource-panel";
import { ResourceAction, actionArgs, actionPlan, confirmText, doneText, requestFingerprint } from "./resource-action";
import { kindFor } from "./crm-op-form-kind";
import { ResultView, ValueList } from "./resource-values";
import { CrmResources } from "./crm-resources";

const find = (key: string): ResourceDef => Object.values(RESOURCES).flat().find((r) => r.key === key)!;
const CAMPAIGNS = find("email-campaigns");
const PROFILE = find("business-profile");
const TEAM = find("team");
const html = (el: React.ReactElement) => renderToStaticMarkup(<CrmProvider>{el}</CrmProvider>);
const status = (s: Partial<{ writesOn: boolean; adminKey: boolean }> = {}) => {
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false, ...s };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
};

/* Shapes from the openapi.json example for GET /v1/email-campaigns. */
const DRAFT = { id: "camp-1", name: "Studio owners: what a missed booking costs", status: "draft", audience: "tags", tags: ["Studio owner", "Demo booked"], not_booked: true, total_recipients: 18, results: null, updated_at: "2026-11-09T17:00:00Z" };
const SENT = { id: "camp-2", name: "Demo follow-up", status: "sent", audience: "everyone", total_recipients: 12, results: { recipients: 12, opened: 7, clicked: 2, booked: 2 }, updated_at: "2026-11-08T17:00:00Z" };
const text = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  for (const o of [reads, queries]) for (const k of Object.keys(o)) delete o[k];
  runs.length = 0;
  confirms.length = 0;
  status();
});

describe("list resource (Email campaigns)", () => {
  it("loading", () => {
    const out = html(<ResourcePanel def={CAMPAIGNS} />);
    expect(out).toContain("Loading Email campaigns");
    expect(out).toContain("Email campaigns");
    expect(out).toContain("Not synced yet");
  });

  it("error: a 403 for an area this account does not have shows Zuops's reason, never a crash", () => {
    reads.list_email_campaigns = { error: { reason: "Email marketing is off for this account. Turn it on in Settings > Features.", code: "not_enabled", status: 403 } };
    const out = html(<ResourcePanel def={CAMPAIGNS} />);
    expect(out).toContain("Email marketing is off for this account.");
    expect(out).toContain("Retry");
    expect(out).toContain('role="alert"');
  });

  it("empty", () => {
    reads.list_email_campaigns = { data: { campaigns: [], has_more: false } };
    expect(html(<ResourcePanel def={CAMPAIGNS} />)).toContain("No email campaigns yet");
  });

  it("data: rows with status as a word, counts and nested results", () => {
    reads.list_email_campaigns = { data: { campaigns: [DRAFT, SENT], has_more: false } };
    const out = html(<ResourcePanel def={CAMPAIGNS} />);
    expect(out).toContain("Studio owners: what a missed booking costs");
    expect(out).toContain("Draft");
    expect(out).toContain("Sent");
    expect(out).toContain(">18<");
    expect(out).toContain(">7<");
    expect(out).toContain("Booked");
    expect(out).toContain("New draft");
    expect(out).toContain("Synced");
    expect(out).not.toContain("—");
  });

  it("the sub-navigation mounts only the first resource of a group", () => {
    reads.list_ws_automations = { data: { automations: [] } };
    const out = html(<CrmResources group="automations" />);
    expect(out).toContain("Automation folders");
    expect(out).toContain("No automations yet");
    expect(out).not.toContain("Loading Automation folders");
  });
});

describe("single resource (Business profile)", () => {
  it("loading, error, empty, data", () => {
    expect(html(<ResourcePanel def={PROFILE} />)).toContain("Loading Business profile");

    reads.get_business_profile = { error: { reason: "Zuops could not find that.", code: "not_found", status: 404 } };
    expect(html(<ResourcePanel def={PROFILE} />)).toContain("Zuops could not find that.");

    reads.get_business_profile = { data: { business_profile: {} } };
    expect(html(<ResourcePanel def={PROFILE} />)).toContain("Nothing set for business profile yet");

    reads.get_business_profile = { data: { business_profile: { name: "Northline Sound", timezone: "America/Los_Angeles", business_email: "hi@northline.example" } } };
    const out = html(<ResourcePanel def={PROFILE} />);
    expect(out).toContain("Northline Sound");
    expect(out).toContain("America/Los_Angeles");
    expect(out).toContain("Business email");
    expect(out).toContain("Edit");
  });

  it("F-V2 (U-06): the API key reads GET /v1/keys/self's `key` object: name, access level and requests per minute, never the prefix", () => {
    reads.key_self = {
      data: {
        key: { id: "k1", key_prefix: "zu-ab12", name: "Pulse OS", is_active: true, access_level: "write", scopes: ["leads:read"], workspace: { id: "w", name: "Northline" }, rate_limit_per_min: 600 },
        endpoints: { api: "https://api.usezu.com/v1", mcp: "https://api.usezu.com/mcp" },
      },
    };
    const out = html(<ResourcePanel def={find("api-key")} />);
    expect(out).toContain("Pulse OS");
    expect(out).toContain("Write");
    expect(out).toContain(">600<");
    expect(out).not.toContain("zu-ab12");
    expect(out).not.toContain("leads:read");
    expect(out).not.toContain("–");
  });

  it("secret-like fields are hidden in every definition list", () => {
    reads.get_business_profile = { data: { business_profile: { name: "Northline", webhook_secret: "whsec_live" } } };
    const out = html(<ResourcePanel def={PROFILE} />);
    expect(out).not.toContain("whsec_live");
    expect(out).toContain("Hidden");
  });
});

describe("columns (F-V1, F-V2)", () => {
  it("F-V1 (U-14): the first column goes through the same formatter, so a date is a date, not an ISO string", () => {
    reads.list_activity = { data: { events: [{ id: "e1", occurred_at: "2026-11-09T17:00:00Z", category: "change", description: "Changed the AI texting settings", actor_label: "API key · Zapier" }] } };
    const out = html(<ResourcePanel def={find("activity")} />);
    expect(out).not.toContain("2026-11-09T17:00:00Z");
    expect(out).toMatch(/Nov(ember)? 9/);
    expect(out).toContain("Changed the AI texting settings");
  });

  it("F-V2: a column no row has a value for is left out, while the detail keeps every field", () => {
    reads.list_email_campaigns = { data: { campaigns: [{ id: "c", name: "Only a name", status: "draft" }], has_more: false } };
    const out = html(<ResourcePanel def={CAMPAIGNS} />);
    expect(out).toContain("Only a name");
    expect(out).not.toContain(">Opened<");
    expect(out).not.toContain(">Recipients<");
    expect(out).toContain(">Status<");
  });

  it("F-V2 (c): iMessage lines show the device name and settings.ai_replies, not the row id", () => {
    reads.list_imessage_lines = { data: { lines: [{ id: "line-uuid-1", number: "+17145550123", label: null, device_name: "Front desk iMac", is_default: true, online: true, settings: { ai_replies: true } }], has_more: false } };
    const out = html(<ResourcePanel def={find("imessage-lines")} />);
    expect(out).toContain("Front desk iMac");
    expect(out).not.toContain(">line-uuid-1<"); // only as the open button's data-row-open, never shown
    expect(out).toContain(">AI replies<");
  });

  it("F-V2 (b): AI calling campaigns read leads_total and calls_connected", () => {
    reads.list_call_campaigns = { data: { campaigns: [{ id: "cc", name: "Quote follow-up", status: "running", leads_total: 40, calls_connected: 11 }] } };
    const out = html(<ResourcePanel def={find("call-campaigns")} />);
    expect(out).toContain(">40<");
    expect(out).toContain(">11<");
  });

  it("F-V2 (d): the sub-account list has no domain column", () => {
    expect(find("workspace").list!.columns.map((c) => c.label)).not.toContain("Domain");
  });
});

describe("actions", () => {
  it("F-U5: Send names the audience in words and states no number, even when the row carries one", () => {
    const send = CAMPAIGNS.actions!.find((a) => a.op === "send_email_campaign")!;
    const out = html(<ResourceAction action={send} ctx={{ source: DRAFT, pathValue: DRAFT.id, invalidate: ["list_email_campaigns"] }} />);
    expect(out).toContain("Send or schedule");
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe("Send Studio owners: what a missed booking costs?");
    const body = text(confirms[0].body);
    expect(body).toContain("everyone tagged Studio owner and Demo booked who has not booked");
    expect(body).not.toMatch(/\b18\b/);
    expect(runs).toHaveLength(0);

    // The Audience picked in the same form wins over the saved one.
    const t = confirmText(send, { "body:audience": "everyone" }, DRAFT, "reaches");
    expect(t.body).toContain("It emails everyone with an email address");
    expect(t.body).not.toMatch(/\d/);
    expect(t.consequence).toBe("This reaches real people.");
    expect(confirmText(send, { "body:audience": "stages", "body:stages": "new, contacted" }, DRAFT, "reaches").body).toContain("everyone in the stages new and contacted");
  });

  it("F-B1: every write action mounts exactly one ConfirmDialog (closed until the server's kind or the config asks); reads mount none", () => {
    for (const def of Object.values(RESOURCES).flat()) {
      for (const a of def.actions ?? []) {
        confirms.length = 0;
        const isRead = READ_ACTION_OPS.has(a.op);
        html(<ResourceAction action={a} ctx={{ source: { id: "x", name: "X" }, pathValue: "x", invalidate: [], isRead }} />);
        expect(confirms.length, `${def.key}: ${a.label}`).toBe(isRead ? 0 : 1);
      }
    }
    expect(runs).toHaveLength(0);
  });

  it("F-B1: the dialog states the kind's consequence and what it acts on; without config words it still says both", () => {
    const enroll = find("automations").actions!.find((a) => a.op === "enroll_automation")!;
    const t = confirmText(enroll, { "body:lead_ids": "a, b\nc" }, { name: "Demo booked" }, "reaches");
    expect(t.title).toBe("Enroll 3 leads?");
    expect(t.body).toContain("Demo booked can text and email the 3 leads you listed");
    expect(t.consequence).toBe("This reaches real people.");
    const bare = { label: "Tidy", op: "x", scope: "row" as const };
    const g = confirmText(bare, {}, { name: "Spring list" }, "spends");
    expect(g).toEqual({ title: "Tidy?", body: "This acts on Spring list.", consequence: "This uses credits or starts paid work." });
    expect(confirmText(bare, {}, null, undefined).consequence).toBe("This reaches real people.");
  });

  it("F-B1: actionPlan runs only when the server says no confirm and the config does not ask", () => {
    const plain: ActionDef = { label: "Save", op: "x", scope: "panel" };
    expect(actionPlan(plain, null)).toBe("run");
    expect(actionPlan(plain, "spends")).toBe("confirm");
    expect(actionPlan(plain, undefined)).toBe("confirm");
    expect(actionPlan({ ...plain, confirm: { title: "t", body: "b", label: "l", always: true } }, null)).toBe("confirm");
    expect(actionPlan(plain, "delete", true)).toBe("read");
  });

  it("action arguments carry the row id, a fixed body and row fields", () => {
    const on = find("automations").actions!.find((a) => a.label === "Switch on")!;
    expect(actionArgs(on, {}, { pathValue: "auto-1" })).toEqual({ path: { automation_id: "auto-1" }, query: {}, body: { enabled: true } });
    const move = find("automations").actions!.find((a) => a.op === "move_automations")!;
    expect(actionArgs(move, { "body:folder_id": "f1" }, { source: { id: "auto-1" } })).toEqual({ path: {}, query: {}, body: { automation_ids: ["auto-1"], folder_id: "f1" } });
    const del = CAMPAIGNS.actions!.find((a) => a.op === "delete_email_campaign")!;
    expect(actionArgs(del, {}, { pathValue: null })).toEqual({ error: "This row has no id Zuops can use." });
  });

  it("an admin action is off without a Full access key and says why", () => {
    status({ adminKey: false });
    const invite = TEAM.actions!.find((a) => a.op === "invite_member")!;
    const out = html(<ResourceAction action={invite} ctx={{ invalidate: [] }} />);
    expect(out).toContain("Needs a Full access key");
    expect(out).toMatch(/<button[^>]*disabled/);

    status({ adminKey: true });
    const ok = html(<ResourceAction action={invite} ctx={{ invalidate: [] }} />);
    expect(ok).not.toContain("Needs a Full access key");
  });

  it("read only: write actions are off, reads still work", () => {
    status({ writesOn: false });
    reads.list_members = { data: { members: [{ id: "m1", full_name: "Lawrence", email: "l@example.com", role: "owner" }], pending_invites: [] } };
    const out = html(<ResourcePanel def={TEAM} />);
    expect(out).toContain("Lawrence");
    expect(out).toContain("Read only here. This deployment cannot change Zuops.");
  });

  it("row actions follow the row's show rule", () => {
    const out = html(<RowActions def={CAMPAIGNS} row={SENT} rowIdKey="id" />);
    expect(out).toContain("Duplicate");
    expect(out).not.toContain("Send or schedule");
    expect(out).not.toContain("Edit draft");
    const draft = html(<RowActions def={CAMPAIGNS} row={DRAFT} rowIdKey="id" />);
    expect(draft).toContain("Send or schedule");
  });

  it("the read actions set matches the GET operations the config uses as actions", () => {
    const gets = new Set(Object.values(RESOURCES).flat().flatMap((r) => r.actions ?? []).filter((a) => ZU_OPS[a.op].method === "GET").map((a) => a.op));
    expect([...READ_ACTION_OPS].sort()).toEqual([...gets].sort());
  });
});

describe("round 3", () => {
  const AUTOS = () => find("automations");
  const switchOn = () => AUTOS().actions!.find((a) => a.label === "Switch on")!;
  const switchOff = () => AUTOS().actions!.find((a) => a.label === "Switch off")!;

  it("R3-R1: switching off is one click (the policy's kind for {enabled:false} is none); switching on confirms that it reaches real leads", () => {
    expect(kindFor("toggle_ws_automation", switchOff().body)).toBeNull();
    expect(actionPlan(switchOff(), kindFor("toggle_ws_automation", switchOff().body))).toBe("run");
    const onKind = kindFor("toggle_ws_automation", switchOn().body);
    expect(onKind).toBe("reaches");
    expect(actionPlan(switchOn(), onKind)).toBe("confirm");
    const t = confirmText(switchOn(), {}, { name: "Demo booked" }, onKind);
    expect(t.body).toContain("Demo booked will run for real leads");
    expect(t.consequence).toBe("This reaches real people.");
  });

  it("R3-R1: the sheet's button follows the CURRENT state: the re-read record wins over the list copy", () => {
    const row = { id: "a1", name: "Demo booked", enabled: false };
    const before = html(<RowActions def={AUTOS()} row={row} rowIdKey="id" />);
    expect(before).toContain(">Switch on<");
    expect(before).not.toContain(">Switch off<");
    const after = html(<RowActions def={AUTOS()} row={row} record={{ id: "a1", name: "Demo booked", enabled: true }} rowIdKey="id" />);
    expect(after).toContain(">Switch off<");
    expect(after).not.toContain(">Switch on<");
  });

  it("R3-R2: the toast says what was done: sent now, or scheduled for the time", () => {
    const send = CAMPAIGNS.actions!.find((a) => a.op === "send_email_campaign")!;
    expect(doneText(send, {}, { scheduled: false, recipients: 12 })).toBe("Zuops is sending it now.");
    expect(doneText(send, {}, undefined)).toBe("Zuops is sending it now.");
    const at = doneText(send, { "body:schedule_at": "2026-11-20T09:30" }, { scheduled: true, campaign: { scheduled_at: "2026-11-20T17:30:00Z" } });
    expect(at).toMatch(/^Scheduled in Zuops for .*Nov 20/);
    expect(at).not.toContain("as scheduled");
    expect(doneText({ done: "Saved." }, { "body:schedule_at": "2026-11-20T09:30" }, null)).toBe("Saved.");
  });

  it("R3-R2: the send confirm names the whole audience, filters included, and when", () => {
    const send = CAMPAIGNS.actions!.find((a) => a.op === "send_email_campaign")!;
    const saved = confirmText(send, {}, DRAFT, "reaches").body;
    expect(saved).toContain("everyone tagged Studio owner and Demo booked who has not booked");
    expect(saved).toContain("sender now.");
    const form = confirmText(send, { "body:audience": "everyone", "body:not_booked": "yes", "body:schedule_at": "2026-11-20T09:30", "body:drip": '{"every": 50, "minutes": 60}' }, DRAFT, "reaches").body;
    expect(form).toContain("everyone with an email address who has not booked");
    expect(form).toMatch(/sender at .*Nov 20/);
    expect(form).toContain("A few at a time: 50 emails every 1 hour.");
    expect(confirmText(send, { "body:not_booked": "no" }, DRAFT, "reaches").body).not.toContain("who has not booked");
    expect(send.fields!.map((f) => f.name)).toEqual(expect.arrayContaining(["not_booked", "drip"]));
  });

  it("R3-R3: form submissions lead with when and who, then the answers as label: value; no id columns", () => {
    const view = find("smart-forms").actions!.find((a) => a.op === "list_form_submissions")!;
    const data = {
      submissions: [{
        id: "sub-uuid-1", lead_id: "lead-uuid-1", booking_id: "bk-uuid-1", first_name: "Maya", last_name: "Lopez", phone: "+13105550100", email: "maya@example.com",
        notes: "", status: "complete", created_at: "2026-11-09T17:00:00Z",
        custom_fields: { raw_answers: {}, custom_answers: [{ key: "pulse_studio_name", value: "Northline Studio", question: "Studio name", field_type: "text" }, { key: "pulse_sms_marketing_consent", value: true, question: "Texts OK", field_type: "boolean" }] },
      }],
    };
    const out = renderToStaticMarkup(<ResultView data={data} columns={view.resultColumns} />);
    const heads = [...out.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads[0]).toBe("Submitted");
    expect(heads).toEqual(expect.arrayContaining(["Name", "Contact", "Answers"]));
    expect(heads.some((h) => /\bid\b/i.test(h))).toBe(false);
    expect(out).toContain("Maya Lopez");
    expect(out).toContain("Studio name:</span> Northline Studio");
    expect(out).toContain("Texts OK:</span> Yes");
    expect(out).not.toContain("sub-uuid-1");
    expect(out).not.toContain("lead-uuid-1");
    // Without config columns, ids still never show as columns.
    const auto = renderToStaticMarkup(<ResultView data={{ rows: [{ id: "x-1", lead_id: "l-1", name: "Spring", status: "sent" }] }} />);
    expect(auto).toContain(">Name<");
    expect(auto).not.toContain(">Id<");
    expect(auto).not.toContain(">Lead id<");
  });

  it("R3-R4: Business hours read as day rows, the calendar id is muted and labelled, settings are Yes/No", () => {
    const data = {
      availability: {
        workspace_id: "ws-1", timezone: "America/Los_Angeles",
        weekly_hours: { mon: [["09:00", "17:00"]], tue: [["09:00", "12:00"], ["13:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "15:00"]], sat: [], sun: [] },
        slot_minutes: 30, buffer_minutes: 10, default_calendar_id: "cal-uuid-1", scheduling_mode: "exact", arrival_window_minutes: 0, date_overrides: [],
      },
      configured: true,
    };
    reads.get_availability = { data };
    const out = html(<ResourcePanel def={find("availability")} />);
    expect(out).not.toMatch(/\d+ fields/);
    expect(out).toContain(">Mon<");
    expect(out).toContain("09:00 to 17:00");
    expect(out).toContain("09:00 to 12:00, 13:00 to 17:00");
    expect(out).toMatch(/>Sat<\/dt><dd[^>]*>Closed</);
    expect(out).toContain("font-mono text-xs text-steel");
    expect(out).toContain("cal-uuid-1");
    expect(out).toContain(">Default calendar<");
    expect(out).toContain(">Yes<");
    expect(out).not.toContain("ws-1");
  });

  it("R3-R4: an id is named when the same answer carries the name; lists of records are sub-rows, primitives comma lists", () => {
    const value = { default_calendar_id: "c1", calendars: [{ id: "c1", name: "Studio A", slot_minutes: 30 }], tags: ["vip", "studio"], ai_replies: false };
    const out = renderToStaticMarkup(<ValueList value={value} />);
    expect(out).toMatch(/>Default calendar<\/dt><dd[^>]*><span>Studio A</);
    expect(out).toContain("vip, studio");
    expect(out).toContain("Studio A</span><span class=\"text-ash\">. Slot minutes: 30");
    expect(out).toContain(">No<");
    expect(out).not.toContain("items</summary>");
  });

  it("R3-R4: the API key keeps name, access level and rate limit when key strings are hidden", () => {
    reads.key_self = { data: { key: { name: "Pulse OS", access_level: "write", rate_limit_per_min: 600, key_prefix: "hidden" }, endpoints: {} } };
    const out = html(<ResourcePanel def={find("api-key")} />);
    expect(out).toContain("Pulse OS");
    expect(out).toContain(">600<");
  });

  it("R3-R6: the retry key covers the exact body, row data and changed-fields diff included", () => {
    const move = AUTOS().actions!.find((a) => a.op === "move_automations")!;
    const v = { "body:folder_id": "f1" };
    const a = requestFingerprint(actionArgs(move, v, { source: { id: "a1" } }), v);
    const b = requestFingerprint(actionArgs(move, v, { source: { id: "a2" } }), v);
    expect(a).not.toBe(b); // same form values, different row: a different request
    expect(a).toContain("automation_ids");
    const edit = CAMPAIGNS.actions!.find((x) => x.op === "update_email_campaign")!;
    const vals = { "body:name": "New name" };
    const one = requestFingerprint(actionArgs(edit, vals, { source: DRAFT, pathValue: "camp-1", prefillFrom: { name: "Old" } }), vals);
    const two = requestFingerprint(actionArgs(edit, vals, { source: DRAFT, pathValue: "camp-1", prefillFrom: { name: "New name" } }), vals);
    expect(one).not.toBe(two);
    expect(requestFingerprint(actionArgs(move, {}, { source: { id: "a1" } }), {})).toMatch(/^values:/);
  });
});

describe("round 4", () => {
  it("R4-R2: counts are pluralized: Enroll 1 lead, Enroll 3 leads", () => {
    const enroll = find("automations").actions!.find((a) => a.op === "enroll_automation")!;
    const one = confirmText(enroll, { "body:lead_ids": "a" }, { name: "Demo booked" }, "reaches");
    expect(one.title).toBe("Enroll 1 lead?");
    expect(one.body).toContain("the 1 lead you listed");
    expect(confirmText(enroll, { "body:lead_ids": "a, b" }, { name: "Demo booked" }, "reaches").title).toBe("Enroll 2 leads?");
    const survey = find("surveys").actions!.find((a) => a.op === "send_survey")!;
    expect(confirmText(survey, { "body:lead_ids": "a" }, { name: "Check-in" }, "reaches").title).toBe("Send Check-in to 1 lead?");
  });

  const AVAIL = { availability: { timezone: "America/Los_Angeles", default_calendar_id: "cal-uuid-1", date_overrides: [] }, configured: true };

  it("R4-R4: with no name at hand the id is labelled plainly as a Calendar id, and nothing is fetched for it", () => {
    reads.get_availability = { data: AVAIL };
    const out = html(<ResourcePanel def={find("availability")} />);
    expect(out).toContain("Calendar id </span>cal-uuid-1");
    expect(out).not.toContain(">id </span>");
  });

  it("R4-R4: when the calendars list is already cached, the default calendar shows its name", () => {
    reads.get_availability = { data: AVAIL };
    reads.list_calendars = { data: { calendars: [{ id: "cal-uuid-1", name: "Studio A" }] } };
    const out = html(<ResourcePanel def={find("availability")} />);
    expect(out).toMatch(/>Default calendar<\/dt><dd[^>]*><span>Studio A</);
    expect(out).not.toContain("cal-uuid-1");
    expect(find("availability").single!.names).toEqual({ op: "list_calendars", rowsKey: "calendars" });
  });
});
