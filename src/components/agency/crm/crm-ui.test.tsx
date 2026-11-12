import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Formatters, the write gate and the shared states. Server-rendered with mocked
   Convex queries; not a browser check. */
const fixtures: Record<string, unknown> = {};
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : fixtures[getFunctionName(ref)]),
  useAction: () => async () => ({ ok: true, status: 200, json: null, limits: {} }),
}));

import { CrmProvider } from "./crm-context";
import {
  ConfirmDialog, ReadOnlyBanner, StageBadge, WriteButton, ZuErrorState, dateTime, money, phone, refreshGate, relTime,
  stageTone, syncedAgo, writeBlock, READ_ONLY_REASON, NEEDS_ADMIN_REASON, SyncBar, confirmCopy, plural, restoreFocus, type Opener,
} from "./crm-ui";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const status = (s: Partial<{ keyConfigured: boolean; writesOn: boolean; adminKey: boolean; webhookConfigured: boolean }>) => {
  fixtures["crm:status"] = { keyConfigured: true, writesOn: true, adminKey: true, webhookConfigured: false, ...s };
  fixtures["crm:signal"] = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
};

beforeEach(() => { for (const k of Object.keys(fixtures)) delete fixtures[k]; });

describe("formatters", () => {
  it("money: cents to dollars, whole amounts without cents, nothing as a dash", () => {
    expect(money(118800)).toBe("$1,188");
    expect(money(1050)).toBe("$10.50");
    expect(money(0)).toBe("$0");
    expect(money(null)).toBe("–");
    expect(money(undefined)).toBe("–");
    expect(money(2500, "eur")).toBe("€25");
    expect(money(2500, "not-a-code")).toBe("$25");
  });

  it("phone: US numbers formatted, others left as given", () => {
    expect(phone("+12135550142")).toBe("(213) 555-0142");
    expect(phone("2135550142")).toBe("(213) 555-0142");
    expect(phone("+442071234567")).toBe("+442071234567");
    expect(phone(null)).toBe("");
  });

  it("relTime: recent times in words, older ones as a date", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(relTime("2026-11-11T11:59:40Z", now)).toBe("just now");
    expect(relTime("2026-11-11T11:55:00Z", now)).toBe("5 min ago");
    expect(relTime("2026-11-11T09:00:00Z", now)).toBe("3 h ago");
    expect(relTime("2026-11-10T08:00:00Z", now)).toBe("Yesterday");
    expect(relTime("2026-11-06T08:00:00Z", now)).toBe("Nov 6");
    expect(relTime("2025-11-06T08:00:00Z", now)).toBe("Nov 6, 2025");
    expect(relTime(null, now)).toBe("");
    expect(relTime("not a date", now)).toBe("");
  });

  it("dateTime: in the given time zone with its name", () => {
    expect(dateTime("2026-11-12T22:00:00Z", "America/Los_Angeles")).toBe("Thu, Nov 12, 2:00 PM PST");
    expect(dateTime("2026-11-12T22:00:00Z", "Not/AZone")).toMatch(/Nov 12/);
    expect(dateTime(null)).toBe("");
  });

  it("synced line and the 30 second refresh gate (U-08)", () => {
    expect(syncedAgo(null, 0)).toBe("Not synced yet");
    expect(syncedAgo(1000, 2000)).toBe("Synced just now");
    expect(syncedAgo(0, 12_000)).toBe("Synced 12 s ago");
    expect(syncedAgo(0, 180_000)).toBe("Synced 3 min ago");
    expect(refreshGate(null, 5)).toEqual({ ok: true, waitS: 0 });
    expect(refreshGate(0, 10_000)).toEqual({ ok: false, waitS: 20 });
    expect(refreshGate(0, 30_000)).toEqual({ ok: true, waitS: 0 });
  });

  it("copy has no em dashes", () => {
    for (const s of [READ_ONLY_REASON, NEEDS_ADMIN_REASON, money(null)]) expect(s).not.toContain("—");
  });
});

describe("write gate (X-08)", () => {
  it("writeBlock says why a write is off", () => {
    expect(writeBlock({ canWrite: false, hasAdminKey: true })).toBe(READ_ONLY_REASON);
    expect(writeBlock({ canWrite: true, hasAdminKey: false })).toBeNull();
    expect(writeBlock({ canWrite: true, hasAdminKey: false }, true)).toBe(NEEDS_ADMIN_REASON);
    expect(writeBlock({ canWrite: true, hasAdminKey: true }, true)).toBeNull();
  });

  it("WriteButton is off with the reason when this deployment is read only", () => {
    status({ writesOn: false });
    const out = html(<CrmProvider><WriteButton>Save to Zuops</WriteButton></CrmProvider>);
    expect(out).toMatch(/<button[^>]*\sdisabled=""/);
    expect(out).toContain(READ_ONLY_REASON);
  });

  it("an admin WriteButton is off without a Full access key, a normal one is on", () => {
    status({ adminKey: false });
    const admin = html(<CrmProvider><WriteButton admin>Delete</WriteButton></CrmProvider>);
    expect(admin).toMatch(/<button[^>]*\sdisabled=""/);
    expect(admin).toContain(NEEDS_ADMIN_REASON);
    const normal = html(<CrmProvider><WriteButton>Save</WriteButton></CrmProvider>);
    expect(normal).not.toMatch(/\sdisabled=""/);
    expect(normal).not.toContain(NEEDS_ADMIN_REASON);
  });

  it("WriteButton is off while the status is still loading or with no provider", () => {
    expect(html(<WriteButton>Save</WriteButton>)).toMatch(/\sdisabled=""/);
    expect(html(<CrmProvider><WriteButton>Save</WriteButton></CrmProvider>)).toMatch(/\sdisabled=""/);
  });
});

describe("states", () => {
  it("read-only banner shows only when the key is set and writes are off", () => {
    status({ writesOn: false });
    expect(html(<CrmProvider><ReadOnlyBanner /></CrmProvider>)).toContain("Read only here. This deployment cannot change Zuops.");
    status({ writesOn: true });
    expect(html(<CrmProvider><ReadOnlyBanner /></CrmProvider>)).toBe("");
    status({ keyConfigured: false, writesOn: false });
    expect(html(<CrmProvider><ReadOnlyBanner /></CrmProvider>)).toBe("");
  });

  it("error state shows Zuops's reason as given, with Retry", () => {
    const out = html(<ZuErrorState error={{ reason: "That time was just taken.", code: "slot_full", status: 409 }} onRetry={() => undefined} />);
    expect(out).toContain("That time was just taken.");
    expect(out).toContain("Zuops refused");
    expect(out).toContain("Retry");
    expect(out).toContain('role="alert"');
    expect(html(<ZuErrorState error={{ reason: "x", status: 0 }} />)).toContain("Could not reach Zuops");
  });

  it("stage badge is a word and an icon, never color alone", () => {
    const out = html(<StageBadge stage={{ id: "s", key: "booked", label: "Booked", color: "cyan", behavior: "booked" }} />);
    expect(out).toContain("Booked");
    expect(out).toContain("<svg");
    expect(html(<StageBadge stage="quote_sent" />)).toContain("Quote sent");
    expect(html(<StageBadge stage={null} />)).toContain("No stage");
    expect(stageTone("emerald")).toBe("positive");
    expect(stageTone("rose")).toBe("critical");
    expect(stageTone(undefined)).toBe("neutral");
  });

  it("sync bar renders the synced line and a Refresh button", () => {
    const out = html(<SyncBar fetchedAt={null} onRefresh={() => undefined} />);
    expect(out).toContain("Not synced yet");
    expect(out).toContain("Refresh");
  });

  it("confirm dialog renders its trigger closed; nothing runs until the confirm button", () => {
    const onConfirm = vi.fn();
    const out = html(<ConfirmDialog title="Delete?" body="Gone for good." confirmLabel="Delete" onConfirm={onConfirm} trigger={<button type="button">Open</button>} />);
    expect(out).toContain("Open");
    expect(out).not.toContain("Gone for good.");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("confirmCopy", () => {
  it("one plain consequence line per kind the server confirms", () => {
    expect(confirmCopy("reaches")).toBe("This reaches real people.");
    expect(confirmCopy("changes_sending")).toBe("This changes what is sent automatically to real people.");
    expect(confirmCopy("spends")).toBe("This uses credits or starts paid work.");
    expect(confirmCopy("exposes")).toBe("This sends lead data outside the account or changes who can access it.");
    expect(confirmCopy("delete")).toBe("This deletes something.");
  });
});

describe("R3-U6 counts", () => {
  it("R3-U6: one lead, two leads, no leads", () => {
    expect(plural(1, "lead")).toBe("1 lead");
    expect(plural(0, "lead")).toBe("0 leads");
    expect(plural(1000, "lead")).toBe("1,000 leads");
    expect(plural(2, "person", "people")).toBe("2 people");
  });
});

describe("R3-U1 focus return", () => {
  type Stub = HTMLElement & { focused: number };
  const el = (o: { connected?: boolean; visible?: boolean; disabled?: boolean } = {}): Stub => {
    const s = {
      focused: 0,
      isConnected: o.connected ?? true,
      disabled: o.disabled ?? false,
      getClientRects: () => (o.visible === false ? [] : [{}]),
      closest: () => null,
      focus() { s.focused += 1; },
    };
    return s as unknown as Stub;
  };

  it("R3-U1: focus goes to the opener; if it is gone, to the fallback; then to the dialog or panel it sat in", () => {
    const opener = el();
    expect(restoreFocus({ el: opener, key: null, anchor: null })).toBe(true);
    expect(opener.focused).toBe(1);

    const gone = el({ connected: false });
    const fallback = el();
    const anchor = el();
    const o: Opener = { el: gone, key: "card-move:lead-maya", anchor };
    expect(restoreFocus(o, () => fallback)).toBe(true);
    expect(gone.focused).toBe(0);
    expect(fallback.focused).toBe(1);

    expect(restoreFocus({ el: el({ disabled: true }), key: null, anchor }, () => null)).toBe(true);
    expect(anchor.focused).toBe(1);
    expect(restoreFocus({ el: null, key: null, anchor: null })).toBe(false);
  });
});

// For the page render below: panels are lazy chunks (a stub here) and there is
// no Clerk in the test (as in demo mode).
vi.mock("next/dynamic", () => ({ default: () => function Lazy() { return <p>Loading this section</p>; } }));
vi.mock("@/lib/use-optional-clerk", () => ({ useOptionalUser: () => ({ user: null }) }));

describe("Prospects tab (owner request 2026-11-11)", () => {
  it("the CRM tab list has Prospects right after Leads, and only Prospects works without Zuops", async () => {
    const { CRM_TABS, NO_ZUOPS_TABS } = await import("./crm-context");
    const ids = CRM_TABS.map(([id]) => id);
    expect(ids.indexOf("prospects")).toBe(ids.indexOf("leads") + 1);
    expect(CRM_TABS.find(([id]) => id === "prospects")?.[1]).toBe("Prospects");
    expect(NO_ZUOPS_TABS).toEqual(["prospects"]);
  });

  it("without a Zuops key the page still opens, on Prospects, with its note, and the header says Zuops is not connected", async () => {
    fixtures["crm:access"] = { allowed: true };
    status({ keyConfigured: false, writesOn: false, adminKey: false });
    const { default: CrmPage } = await import("@/app/agency/crm/page");
    const out = html(<CrmPage />);
    expect(out).toContain("Zuops not connected");
    expect(out).toMatch(/>Prospects<\/button>/);
    expect(out).toContain("Studios you are prospecting, before they become leads in Zuops. Emails go out from Lawrence or MaxB with their own signatures, and each one still needs your approval.");
    expect(out).not.toContain("Read only here.");
  });

  it("with no CRM access nothing below the gate renders, Prospects included", async () => {
    fixtures["crm:access"] = { allowed: false, reason: "forbidden" };
    const { default: CrmPage } = await import("@/app/agency/crm/page");
    const out = html(<CrmPage />);
    expect(out).not.toContain("Studios you are prospecting");
    expect(out).not.toMatch(/>Prospects<\/button>/);
  });
});
