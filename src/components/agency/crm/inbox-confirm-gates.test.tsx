import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as React from "react";

/* F-U6: anything that restarts automatic sending to a real person goes through
   ConfirmDialog. Every write button is pressed (none may do it), then the
   dialog's onConfirm(grant) must carry confirm. The one-click paths that only
   stop sending stay one click. */

type Props = Record<string, unknown>;
const captured: { buttons: Props[]; dialogs: Props[]; switches: Props[] } = { buttons: [], dialogs: [], switches: [] };
type Read = { data?: unknown };
const reads: Record<string, Read> = {};
const run = vi.fn(async (op: string, args?: unknown) => {
  void op; void args;
  return { ok: true, status: 200, limits: {} };
});

vi.mock("./crm-ui", async (orig) => {
  const actual = await orig<typeof import("./crm-ui")>();
  return {
    ...actual,
    WriteButton: (p: Props & { children?: React.ReactNode }) => {
      captured.buttons.push(p);
      return <button type="button">{p.children}</button>;
    },
    ConfirmDialog: (p: Props & { body?: React.ReactNode; title?: string; trigger?: React.ReactNode }) => {
      captured.dialogs.push(p);
      return <div data-dialog={p.title}>{p.trigger}{p.body}</div>;
    },
  };
});
vi.mock("./crm-context", () => ({
  useCrm: () => ({ canWrite: true, hasAdminKey: false, status: { keyConfigured: true, writesOn: true }, signal: null }),
  useCrmNav: () => ({ openInbox: () => undefined, openCalendar: () => undefined }),
}));
vi.mock("./use-zu", () => ({
  useZuRead: (op: string | null) => {
    const r = (op && reads[op]) || {};
    return { data: r.data, error: null, loading: r.data === undefined, refreshing: false, fetchedAt: null, refresh: () => undefined };
  },
  useZuWrite: () => ({ run, pending: false }),
  useZuFetch: () => async () => ({ data: undefined, error: null }),
  useIdemFor: (fp: string) => `idem:${fp}`,
  newIdem: () => "idem-new",
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined, warning: () => undefined }) }));
vi.mock("@/components/ui/sheet", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Sheet: Pass, SheetBody: Pass, SheetContent: Pass, SheetDescription: Pass, SheetHeader: Pass, SheetTitle: Pass };
});
vi.mock("@/components/ui/toggle", () => ({
  Switch: (p: Props) => { captured.switches.push(p); return <span data-switch="" />; },
  Checkbox: () => <span />,
}));

import { InboxThread } from "./inbox-thread";
import { AppointmentSheet } from "./calendar-appointment-sheet";
import { INBOX_OP } from "./inbox-ops";
import { CAL_OP } from "./calendar-ops";
import { MAYA } from "./crm-test-fixtures";
import type { ConfirmGrant } from "./crm-ui";

const GRANT = { confirm: true } as unknown as ConfirmGrant;
const pressAll = async () => { for (const b of captured.buttons) await (b.onClick as (() => unknown) | undefined)?.(); };
const dialog = (title: RegExp) => captured.dialogs.find((d) => title.test(String(d.title)));
const callsOf = (op: string) => run.mock.calls.filter(([o]) => o === op).map(([, a]) => a as { body?: Record<string, unknown>; confirm?: boolean; idem?: string });

beforeEach(() => {
  captured.buttons.length = 0;
  captured.dialogs.length = 0;
  captured.switches.length = 0;
  run.mockClear();
  for (const k of Object.keys(reads)) delete reads[k];
});

describe("F-U6 Inbox thread", () => {
  const thread = (paused: boolean) => {
    reads[INBOX_OP.thread] = { data: { messages: [] } };
    reads[INBOX_OP.lead] = { data: { lead: MAYA } };
    reads[INBOX_OP.scheduled] = { data: { scheduled_messages: [{ id: "sm1", lead_id: MAYA.id, channel: "sms", body: "See you Thursday", scheduled_at: "2027-01-05T17:00:00Z", status: "pending" }] } };
    return renderToStaticMarkup(
      <InboxThread
        leadId={MAYA.id} suggestions={[]} onBack={() => undefined} onOpenLead={() => undefined}
        conversation={{ lead_id: MAYA.id, name: MAYA.full_name, channel: "sms", ai: { paused } }}
      />,
    );
  };

  it("Resume AI only through ConfirmDialog, naming the lead", async () => {
    thread(true);
    await pressAll();
    expect(callsOf(INBOX_OP.aiPause).some((a) => a.body?.paused === false)).toBe(false);
    const d = dialog(/Turn the AI back on for Maya Okafor/);
    expect(d).toBeTruthy();
    await (d!.onConfirm as (g: ConfirmGrant) => Promise<unknown>)(GRANT);
    expect(callsOf(INBOX_OP.aiPause)).toEqual([expect.objectContaining({ body: { paused: false }, confirm: true })]);
  });

  it("Cancel of a scheduled message stays one click with exactly { status: cancelled } and a key", async () => {
    thread(false);
    await pressAll();
    const updates = callsOf(INBOX_OP.scheduledUpdate);
    expect(updates).toHaveLength(1);
    expect(updates[0].body).toEqual({ status: "cancelled" });
    expect(updates[0].confirm).toBeUndefined();
    expect(updates[0].idem).toMatch(/^idem:/);
    // Send now is a confirm too.
    expect(callsOf(INBOX_OP.sendScheduledNow)).toHaveLength(0);
    await (dialog(/Send this text now/)!.onConfirm as (g: ConfirmGrant) => Promise<unknown>)(GRANT);
    expect(callsOf(INBOX_OP.sendScheduledNow)[0]).toMatchObject({ confirm: true, idem: expect.stringMatching(/^idem:/) });
  });
});

describe("F-U6 appointment sheet", () => {
  const sheet = (status: string, notify: boolean) => renderToStaticMarkup(
    <AppointmentSheet
      booking={{ id: "b1", lead_id: MAYA.id, title: "Mix review", starts_at: "2027-01-05T17:00:00Z", ends_at: "2027-01-05T18:00:00Z", status, notify_lead: notify }}
      onClose={() => undefined} leadName={() => MAYA.full_name ?? null} members={[]} calendars={[]} onOpenLead={() => undefined}
    />,
  );

  it("Back to confirmed only through ConfirmDialog", async () => {
    sheet("no_show", true);
    await pressAll();
    expect(callsOf(CAL_OP.update).some((a) => a.body?.status === "confirmed")).toBe(false);
    await (dialog(/back to confirmed/i)!.onConfirm as (g: ConfirmGrant) => Promise<unknown>)(GRANT);
    expect(callsOf(CAL_OP.update).find((a) => a.body?.status === "confirmed")).toMatchObject({ confirm: true });
  });

  it("reminders ON opens a confirm; reminders OFF is one click", async () => {
    sheet("scheduled", false);
    const sw = captured.switches[0];
    (sw.onCheckedChange as (v: boolean) => void)(true);
    expect(callsOf(CAL_OP.update)).toHaveLength(0);
    await (dialog(/Turn reminders back on for Maya Okafor/)!.onConfirm as (g: ConfirmGrant) => Promise<unknown>)(GRANT);
    expect(callsOf(CAL_OP.update)[0]).toMatchObject({ body: { notify_lead: true }, confirm: true });

    run.mockClear();
    captured.switches.length = 0;
    sheet("scheduled", true);
    (captured.switches[0].onCheckedChange as (v: boolean) => void)(false);
    await Promise.resolve();
    expect(callsOf(CAL_OP.update)[0]).toMatchObject({ body: { notify_lead: false } });
    expect(callsOf(CAL_OP.update)[0].confirm).toBeUndefined();
  });
});
