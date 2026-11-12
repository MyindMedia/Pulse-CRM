import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* The Prospects card that adds Outreach prospects to Zuops (eval U-17),
   server-rendered against fixture query results. Not a browser check. */
const queries: Record<string, unknown> = {};
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : queries[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, pushed: 0, matched: 0, failed: 0, remaining: 0 }),
}));

import { CrmProvider } from "./crm-context";
import { ProspectsToZuops, planLines, pushConfirmCopy, type ProspectsPlan } from "./prospects-zuops";

const PLAN: ProspectsPlan = {
  total: 40, eligible: 31, linked: 6, toPush: 25, skippedNoEmail: 7, skippedOptedOut: 2, keyConfigured: true, writesOn: true, stageReady: true,
};
const html = () => renderToStaticMarkup(<CrmProvider><ProspectsToZuops /></CrmProvider>);

beforeEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  queries["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: false, webhookConfigured: false };
  queries["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
});

describe("ProspectsToZuops", () => {
  it("renders nothing while loading or without CRM access", () => {
    expect(html()).toBe("");
    queries["crmProspects:plan"] = null;
    expect(html()).toBe("");
  });

  it("no key: one quiet line, no button", () => {
    queries["crmProspects:plan"] = { ...PLAN, keyConfigured: false, writesOn: false };
    const out = html();
    expect(out).toContain("Zuops not connected");
    expect(out).not.toContain("<button");
  });

  it("K to push: the summary, skipped counts in words, and the button with the count", () => {
    queries["crmProspects:plan"] = PLAN;
    const out = html();
    expect(out).toContain("6 of 40 prospects are in Zuops, in the Outreach stage.");
    expect(out).toContain("7 have no email, so they are not added. 2 opted out and are never added.");
    expect(out).toContain("Add 25 prospects to Zuops");
    expect(out).not.toContain("data-blocked");
  });

  it("read only: the button is held with the reason", () => {
    queries["crm:status"] = { keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: false };
    queries["crmProspects:plan"] = { ...PLAN, writesOn: false };
    const out = html();
    expect(out).toContain("Read only here. This deployment cannot change Zuops.");
    expect(out).toContain("data-blocked=");
    expect(out).toMatch(/<button[^>]*disabled/);
  });

  it("nothing to push: no button, says so", () => {
    queries["crmProspects:plan"] = { ...PLAN, linked: 31, toPush: 0 };
    const out = html();
    expect(out).toContain("31 of 40 prospects are in Zuops");
    expect(out).toContain("Every prospect with an email is in Zuops.");
    expect(out).not.toContain("Add ");
  });

  it("the confirm text states the count, email only, no phone, nobody emailed", () => {
    expect(pushConfirmCopy(25)).toEqual({
      title: "Add 25 prospects to Zuops?",
      body: "They go into the Outreach stage as leads with their email only. No phone number is sent, so Zuops cannot text or call them. Nobody is emailed by this.",
    });
    expect(pushConfirmCopy(1).title).toBe("Add 1 prospect to Zuops?");
    expect(planLines({ ...PLAN, total: 1, linked: 0, skippedNoEmail: 1, skippedOptedOut: 0 })).toEqual({
      summary: "0 of 1 prospect is in Zuops, in the Outreach stage.",
      skipped: "1 has no email, so it is not added.",
    });
  });

  it("the push flag comes only from the ConfirmDialog grant, and the copy has no em dash", () => {
    const src = readFileSync(path.resolve(__dirname, "prospects-zuops.tsx"), "utf8");
    expect(src).toMatch(/push\(\{\s*\.\.\.grant/);
    expect(src).toMatch(/onConfirm=\{\(grant\)/);
    expect(src).not.toContain("—");
  });
});
