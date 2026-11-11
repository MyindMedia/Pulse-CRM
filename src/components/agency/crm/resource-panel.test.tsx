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
import { RESOURCES, type ResourceDef } from "./resource-config";
import { READ_ACTION_OPS, ResourcePanel, RowActions } from "./resource-panel";
import { ResourceAction, actionArgs, confirmText } from "./resource-action";
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

const DRAFT = { id: "camp-1", name: "Studio owners: what a missed booking costs", status: "draft", recipients: 18, updated_at: "2026-11-09T17:00:00Z" };
const SENT = { id: "camp-2", name: "Demo follow-up", status: "sent", recipients: 12, results: { opened: 7, clicked: 2, replied: 2 } };

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

  it("the API key shows name, access level and rate limit only, never the prefix", () => {
    reads.key_self = { data: { name: "Pulse OS", access_level: "write", rate_limit_per_min: 600, key_prefix: "zu_live_ab12", scopes: ["leads:read"] } };
    const out = html(<ResourcePanel def={find("api-key")} />);
    expect(out).toContain("Pulse OS");
    expect(out).toContain("Write");
    expect(out).toContain("600");
    expect(out).not.toContain("zu_live_ab12");
    expect(out).not.toContain("leads:read");
  });

  it("secret-like fields are hidden in every definition list", () => {
    reads.get_business_profile = { data: { business_profile: { name: "Northline", webhook_secret: "whsec_live" } } };
    const out = html(<ResourcePanel def={PROFILE} />);
    expect(out).not.toContain("whsec_live");
    expect(out).toContain("Hidden");
  });
});

describe("actions", () => {
  it("a row action with a confirm renders through ConfirmDialog, naming the row and its recipient count, and runs nothing by itself", () => {
    const send = CAMPAIGNS.actions!.find((a) => a.op === "send_email_campaign")!;
    const out = html(<ResourceAction action={send} ctx={{ source: DRAFT, pathValue: DRAFT.id, invalidate: ["list_email_campaigns"] }} />);
    expect(out).toContain("Send or schedule");
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe("Send Studio owners: what a missed booking costs?");
    expect(String(confirms[0].body)).toContain("It emails 18 real people");
    expect(runs).toHaveLength(0);
  });

  it("every action with a confirm block in the config renders a ConfirmDialog; others render none", () => {
    for (const def of Object.values(RESOURCES).flat()) {
      for (const a of def.actions ?? []) {
        confirms.length = 0;
        html(<ResourceAction action={a} ctx={{ source: { id: "x", name: "X" }, pathValue: "x", invalidate: [] }} />);
        expect(confirms.length, `${def.key}: ${a.label}`).toBe(a.confirm ? 1 : 0);
      }
    }
  });

  it("confirm text states the count of a list field", () => {
    const enroll = find("automations").actions!.find((a) => a.op === "enroll_automation")!;
    const t = confirmText(enroll, { "body:lead_ids": "a, b\nc" }, { name: "Demo booked" });
    expect(t.title).toBe("Enroll 3 leads?");
    expect(t.body).toContain("Demo booked can text and email these 3 real people");
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
