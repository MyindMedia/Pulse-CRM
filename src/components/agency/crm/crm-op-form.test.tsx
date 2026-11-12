import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* The Functions form, server-rendered (not a browser check), plus its pure
   builders. ConfirmDialog is wrapped so the test sees what it would say. */

const queries: Record<string, unknown> = {};
const runs: Array<{ op: string; args: Record<string, unknown> }> = [];
type ConfirmProps = { title: string; body: React.ReactNode; onConfirm: (g: { readonly confirm: true }) => unknown };
const confirms: ConfirmProps[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: () => ({ data: undefined, error: null, loading: true, refreshing: false, fetchedAt: null, refresh: () => undefined }),
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
      return <div data-confirm="">{p.title} | {p.body}</div>;
    },
  };
});

import { ZU_OPS } from "@convex/crm/ops.generated";
import { CrmProvider } from "./crm-context";
import { OpForm, answerText, opArgs, opFields, opFingerprint, runPlan, confirmSentence, targetText } from "./crm-op-form";
import { confirmCopy } from "./crm-ui";

const html = (el: React.ReactElement) => renderToStaticMarkup(<CrmProvider>{el}</CrmProvider>);

beforeEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
  runs.length = 0;
  confirms.length = 0;
});

describe("fields from the registry", () => {
  it("a strict op (send_message): body fields, enums as selects, arrays as JSON, required marked", () => {
    const f = opFields(ZU_OPS.send_message);
    expect(f.every((x) => x.in === "body")).toBe(true);
    const channel = f.find((x) => x.name === "channel")!;
    expect(channel).toMatchObject({ type: "select", required: true, options: ["sms", "email", "instagram", "messenger"] });
    expect(f.find((x) => x.name === "body")).toMatchObject({ type: "textarea", required: true });
    expect(f.find((x) => x.name === "media_urls")).toMatchObject({ type: "json", jsonShape: "array" });
    expect(f.find((x) => x.name === "audio_message")).toMatchObject({ type: "boolean" });
    const out = html(<OpForm opId="send_message" />);
    expect(out).toContain("channel (required)");
    expect(out).toContain("Reaches people");
    expect(out).not.toContain("More fields (JSON object)");
  });

  it("an openBody op (update_stage): the path param, suggested fields and a free JSON object", () => {
    const op = ZU_OPS.update_stage;
    const f = opFields(op);
    expect(f[0]).toMatchObject({ name: "stage_id", in: "path", required: true });
    if (op.suggest) expect(f.filter((x) => x.in === "body").map((x) => x.name)).toEqual(op.suggest.map((s) => s.name));
    const out = html(<OpForm opId="update_stage" />);
    expect(out).toContain("More fields (JSON object)");
    expect(out).toContain("stage_id (required)");
    const built = opArgs(op, { "path:stage_id": "s1", "body:label": "Won" }, '{"hidden": true}');
    expect(built).toEqual({ path: { stage_id: "s1" }, query: {}, body: { hidden: true, label: "Won" } });
    expect(opArgs(op, { "path:stage_id": "s1" }, "[1]")).toEqual({ error: "More fields must be a JSON object ({ ... })." });
    expect(opArgs(op, {}, "")).toEqual({ error: "stage_id is required." });
  });

  it("a DELETE (delete_tag) only opens a confirm that says it deletes", () => {
    const op = ZU_OPS.delete_tag;
    expect(runPlan(op)).toBe("confirm");
    expect(confirmSentence(op)).toBe("This deletes something.");
    const out = html(<OpForm opId="delete_tag" />);
    expect(out).toContain("Review and confirm");
    expect(out).toContain("Deletes");
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe("Run Delete a tag?");
    expect(runs).toHaveLength(0);
  });

  it("JSON fields are validated before anything is sent", () => {
    const op = ZU_OPS.send_message;
    expect(opArgs(op, { "body:channel": "sms", "body:body": "Hi", "body:media_urls": "[\"https://x\"" }, ""))
      .toEqual({ error: "media_urls is not valid JSON. Check the brackets and quotes." });
    expect(opArgs(op, { "body:channel": "sms", "body:body": "Hi", "body:media_urls": "{}" }, ""))
      .toEqual({ error: "media_urls must be a JSON list ([ ... ])." });
    expect(opArgs(op, { "body:channel": "sms", "body:body": "Hi", "body:media_urls": "[\"https://x\"]" }, ""))
      .toEqual({ path: {}, query: {}, body: { channel: "sms", body: "Hi", media_urls: ["https://x"] } });
  });
});

describe("run paths", () => {
  it("a read runs directly, a plain write runs through WriteButton, a gated op only through confirm", () => {
    expect(runPlan(ZU_OPS.list_leads)).toBe("read");
    expect(runPlan(ZU_OPS.update_tag)).toBe("write");
    expect(runPlan(ZU_OPS.send_message)).toBe("confirm");
    expect(runPlan(ZU_OPS.set_ai_texting)).toBe("confirm");
    expect(confirmSentence(ZU_OPS.set_ai_texting)).toBe("This changes what is sent automatically to real people.");
    expect(confirmSentence(ZU_OPS.send_message)).toBe("This reaches real people.");
    // create_lead starts texts only when run_intake is set
    expect(runPlan(ZU_OPS.create_lead, { full_name: "Maya" })).toBe("write");
    expect(runPlan(ZU_OPS.create_lead, { full_name: "Maya", run_intake: true })).toBe("confirm");
    expect(confirmSentence(ZU_OPS.create_lead, { run_intake: true })).toBe("This starts the new-lead texts for this person.");
  });

  it("F-B1: every non-GET op mounts one ConfirmDialog (its kind is decided from the body at submit); a gated op's button only reviews", () => {
    for (const op of Object.values(ZU_OPS)) {
      confirms.length = 0;
      const out = html(<OpForm opId={op.id} />);
      expect(confirms.length, op.id).toBe(op.method === "GET" ? 0 : 1);
      if (runPlan(op) === "confirm") expect(out, op.id).toContain("Review and confirm");
    }
    expect(runs).toHaveLength(0);
  });

  it("F-B1: body-dependent kinds follow the body about to be sent", () => {
    const opt = ZU_OPS.apply_gbp_optimizer;
    expect(runPlan(opt, { dry_run: true })).toBe("write");
    expect(runPlan(opt, {})).toBe("confirm");
    expect(confirmSentence(opt, {})).toBe(confirmCopy("spends"));
    expect(runPlan(ZU_OPS.create_gbp_post, { approve: true })).toBe("confirm");
    expect(confirmSentence(ZU_OPS.create_gbp_post, { approve: true })).toBe(confirmCopy("reaches"));
    expect(runPlan(ZU_OPS.create_gbp_post, {})).toBe("write");
    const out = html(<OpForm opId="create_gbp_post" />);
    expect(out).toContain("You confirm before those run.");
  });

  it("F-B1: the dialog names what the request acts on", () => {
    expect(targetText(ZU_OPS.delete_tag, { path: { tag_id: "t1" } })).toBe("On tag id t1.");
    expect(targetText(ZU_OPS.send_message, { path: {} })).toBe("On this sub-account.");
  });

  it("F-U7: answers hide secrets, except the one-time signing secret from creating an outbound webhook", () => {
    const leaky = { key: { name: "Pulse OS", key_prefix: "zu-ab12", rate_limit_per_min: 600 }, token: "tok_123", secret: "whsec_1" };
    const t = answerText("get_key_self", leaky);
    expect(t).not.toContain("zu-ab12");
    expect(t).not.toContain("tok_123");
    expect(t).not.toContain("whsec_1");
    expect(t).toContain("Pulse OS");
    expect(t).toContain("600");
    const hook = answerText("create_outbound_webhook", { id: "h1", url: "https://x.example/hook", secret: "whsec_once" });
    expect(hook).toContain("whsec_once");
    expect(answerText("list_tags", undefined)).toBe("");
  });

  it("a Full access op is off without the key", () => {
    const out = html(<OpForm opId="invite_member" />);
    expect(out).toContain("Full access");
    expect(out).toContain("Needs a Full access key");
  });

  it("read only: a read still runs, a write is off", () => {
    queries["crm:status"] = { keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: false };
    expect(html(<OpForm opId="list_tags" />)).not.toContain("Read only here.");
    expect(html(<OpForm opId="update_tag" />)).toContain("Read only here. This deployment cannot change Zuops.");
  });

  it("an unknown op says so", () => {
    expect(html(<OpForm opId="nope" />)).toContain("Zuops has no function called nope.");
  });
});

describe("round 3", () => {
  it("R3-R5: a required choice starts on Choose…, and every required field is checked before any confirm opens", () => {
    const op = ZU_OPS.send_message;
    expect(opArgs(op, { "body:body": "Hi" }, "")).toEqual({ error: "Choose a value for channel." });
    expect(opArgs(op, { "body:channel": "sms" }, "")).toEqual({ error: "body is required." });
    const out = html(<OpForm opId="send_message" />);
    expect(out).toContain("Choose…");
    expect(out).not.toContain(">Not set<");
    expect(runs).toHaveLength(0);
  });

  it("R3-R5: for an op that takes more JSON fields, a required body field may come from that JSON", () => {
    const op = Object.values(ZU_OPS).find((o) => o.openBody && (o.suggest ?? []).some((f) => f.required) && o.pathParams.length === 0);
    if (!op) return;
    const req = (op.suggest ?? []).find((f) => f.required)!;
    expect("error" in opArgs(op, {}, "")).toBe(true);
    expect("error" in opArgs(op, {}, JSON.stringify({ [req.name]: "x" }))).toBe(false);
  });

  it("R3-R6: the retry key is the exact request: the More fields JSON counts, key order does not", () => {
    const op = ZU_OPS.update_stage;
    const a = opFingerprint(op, { "path:stage_id": "s1" }, '{"label": "Won", "hidden": true}');
    const b = opFingerprint(op, { "path:stage_id": "s1" }, '{"hidden": true, "label": "Won"}');
    const c = opFingerprint(op, { "path:stage_id": "s1" }, '{"hidden": false, "label": "Won"}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
