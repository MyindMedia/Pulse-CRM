import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* The prospecting workspace (the old Outreach page, now the CRM's Prospects tab),
   server-rendered against fixture query results like outreach-panels.test.tsx.
   Not a browser check. */
const fixtures: Record<string, unknown> = {};
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => fixtures[getFunctionName(ref)],
  useMutation: () => async () => null,
  useAction: () => async () => null,
}));

import { OutreachWorkspace, PROSPECTING_SECTIONS } from "./outreach-workspace";

beforeEach(() => { for (const k of Object.keys(fixtures)) delete fixtures[k]; });

const SECTIONS = ["Overview", "Discover", "Contacts", "DMs", "Review queue", "Communications", "Meetings", "Links &amp; calendars", "Activity", "Settings"];

describe("OutreachWorkspace", () => {
  it("mounts the ten prospecting sections, in the old order, under its own label", () => {
    const out = renderToStaticMarkup(<OutreachWorkspace />);
    expect(out).toContain('aria-label="Prospecting sections"');
    const at = SECTIONS.map((label) => out.indexOf(`>${label}</button>`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(PROSPECTING_SECTIONS.map(([id]) => id)).toEqual(
      ["overview", "discover", "prospects", "dms", "drafts", "communications", "meetings", "links", "activity", "settings"],
    );
    // No inner tab is called Prospects any more (it was CRM > Prospects > Prospects).
    expect(out).not.toContain(">Prospects</button>");
    expect(PROSPECTING_SECTIONS.find(([id]) => id === "prospects")?.[1]).toBe("Contacts");
    expect(out).not.toContain("<h1");
  });

  it("opens on Contacts (the prospects inbox), not Overview (owner report 2026-11-11)", () => {
    const out = renderToStaticMarkup(<OutreachWorkspace />);
    const trigger = (label: string) => out.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? "";
    expect(trigger("Contacts")).toContain('data-state="active"');
    expect(trigger("Overview")).toContain('data-state="inactive"');
    // Only the active panel has content: the contacts inbox; Overview is an empty, hidden shell.
    expect(out).toMatch(/<div[^>]*data-state="active"[^>]*id="[^"]*-content-prospects"/);
    expect(out).toMatch(/<div[^>]*data-state="inactive"[^>]*id="[^"]*-content-overview"[^>]*><\/div>/);
  });

  it("shows the test-only banner from the outreach overview, as the old page did", () => {
    fixtures["outreach:overview"] = {
      canManage: true, isOwner: true, liveBlockers: [], configured: false, paused: true, mode: "test_only",
      readiness: [], counts: {}, failures: [],
    };
    const out = renderToStaticMarkup(<OutreachWorkspace />);
    expect(out).toContain("Test only.");
    expect(out).toContain("Outreach is also paused.");
    expect(out).not.toContain(">Outreach</h1>"); // the old page header is gone; the CRM page has its own
  });

  it("keeps its inner tab in state, never in the URL hash (the CRM page owns it)", () => {
    const src = readFileSync(path.resolve(__dirname, "outreach-workspace.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/location\.hash|hashchange|history\.(replace|push)State|useRouter|useSearchParams/);
  });
});
