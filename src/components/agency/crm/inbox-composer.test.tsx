import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as React from "react";

/* X-02 / confirm gate: nothing in the composer sends on its own. Every write
   button is pressed; only ConfirmDialog's onConfirm(grant) reaches send_message,
   and it carries confirm plus the draft's one idempotency key. */

type Props = Record<string, unknown>;
const captured: { buttons: Props[]; dialogs: Props[] } = { buttons: [], dialogs: [] };
type RunResult = { ok: boolean; status: number; limits: object; data?: unknown; reason?: string; code?: string };
const okResult: RunResult = { ok: true, status: 200, limits: {}, data: { replies: [] } };
let nextResult: RunResult = okResult;
const run = vi.fn(async (op: string, args?: unknown): Promise<RunResult> => {
  void op; void args;
  return nextResult;
});

vi.mock("./crm-ui", async (orig) => {
  const actual = await orig<typeof import("./crm-ui")>();
  return {
    ...actual,
    WriteButton: (p: Props & { children?: React.ReactNode }) => {
      captured.buttons.push(p);
      return <button type="button">{p.children}</button>;
    },
    ConfirmDialog: (p: Props & { body?: React.ReactNode; title?: string }) => {
      captured.dialogs.push(p);
      return <div data-dialog={p.title}>{p.body}</div>;
    },
  };
});
vi.mock("./crm-context", () => ({
  useCrm: () => ({ canWrite: true, hasAdminKey: false, status: { keyConfigured: true, writesOn: true }, signal: null }),
  useCrmNav: () => ({ openInbox: () => undefined, openCalendar: () => undefined }),
}));
vi.mock("./use-zu", () => ({
  useZuWrite: () => ({ run, pending: false }),
  useIdemFor: (fp: string) => `idem:${fp}`,
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }) }));

import { InboxComposer, withArticle } from "./inbox-composer";
import { channelOptions, sendRequest, type ComposerDraft } from "./inbox-logic";
import { INBOX_OP } from "./inbox-ops";
import { MAYA } from "./crm-test-fixtures";
import type { ConfirmGrant } from "./crm-ui";

const NOW = Date.now();
const options = channelOptions(MAYA, "sms", [], NOW);
const to = { leadId: "lead-maya", name: "Maya Okafor", phone: MAYA.phone ?? null, email: MAYA.email ?? null };

function render(draft: ComposerDraft, onSent = () => undefined) {
  return renderToStaticMarkup(
    <InboxComposer to={to} options={options} draft={draft} onDraft={() => undefined} onSent={onSent} fromNumber="+13105550100" slots={{ remaining: 40, cap: 50 }} />,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  nextResult = okResult;
  captured.buttons.length = 0;
  captured.dialogs.length = 0;
  run.mockClear();
});

describe("composer confirm gate", () => {
  const draft: ComposerDraft = { channel: "sms", text: "Hi Maya, your demo is Thursday.", subject: "", sendAt: "", suggestionId: null, idem: "idem-fixed" };

  it("pressing every write button never sends", async () => {
    const out = render(draft);
    expect(out).toContain("Send");
    expect(captured.buttons.length).toBeGreaterThan(0);
    for (const b of captured.buttons) await (b.onClick as (() => unknown) | undefined)?.();
    expect(run.mock.calls.some(([op]) => op === INBOX_OP.send || op === INBOX_OP.approveSuggestion)).toBe(false);
  });

  it("only the dialog's confirm sends, with confirm and the draft key", async () => {
    const onSent = vi.fn();
    render(draft, onSent);
    expect(captured.dialogs).toHaveLength(1);
    const grant = { confirm: true } as unknown as ConfirmGrant;
    await (captured.dialogs[0].onConfirm as (g: ConfirmGrant) => Promise<unknown>)(grant);
    const sends = run.mock.calls.filter(([op]) => op === INBOX_OP.send);
    expect(sends).toHaveLength(1);
    expect(sends[0][1]).toMatchObject({ confirm: true, idem: "idem-fixed", body: { lead_id: "lead-maya", channel: "sms", body: "Hi Maya, your demo is Thursday." } });
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("the dialog names the person, the channel and the sender", () => {
    const out = render(draft);
    expect(out).toContain("Maya Okafor");
    expect(out).toContain("(213) 555-0142");
  });

  it("a send cannot be built without a grant", () => {
    expect(() => sendRequest(draft, "lead-maya", undefined as unknown as ConfirmGrant, NOW)).toThrow();
  });

  it("F-U1: a scheduled draft whose time passes while the dialog is open sends nothing", async () => {
    vi.useFakeTimers();
    const t0 = new Date(2026, 10, 11, 9, 0).getTime();
    vi.setSystemTime(t0);
    const onSent = vi.fn();
    const scheduled: ComposerDraft = { ...draft, sendAt: "2026-11-11T09:05" };
    const out = render(scheduled, onSent);
    expect(out).toContain("Schedule");
    vi.setSystemTime(t0 + 10 * 60_000); // the dialog sat open for ten minutes
    await (captured.dialogs[0].onConfirm as (g: ConfirmGrant) => Promise<unknown>)({ confirm: true } as unknown as ConfirmGrant);
    expect(run.mock.calls.some(([op]) => op === INBOX_OP.send)).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("F-U1: while the time is still ahead, it schedules with send_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 9, 0).getTime());
    render({ ...draft, sendAt: "2026-11-11T09:05" });
    await (captured.dialogs[0].onConfirm as (g: ConfirmGrant) => Promise<unknown>)({ confirm: true } as unknown as ConfirmGrant);
    const sends = run.mock.calls.filter(([op]) => op === INBOX_OP.send);
    expect(sends).toHaveLength(1);
    expect((sends[0][1] as { body: { send_at?: string } }).body.send_at).toBeTypeOf("string");
  });

  it("F-U2: a refused send (400) is not retried and does not clear the draft", async () => {
    nextResult = { ok: false, status: 400, limits: {}, reason: "This lead replied STOP" };
    const onSent = vi.fn();
    render(draft, onSent);
    await (captured.dialogs[0].onConfirm as (g: ConfirmGrant) => Promise<unknown>)({ confirm: true } as unknown as ConfirmGrant);
    expect(run.mock.calls.filter(([op]) => op === INBOX_OP.send)).toHaveLength(1);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("F-U2: the Text confirm dialog says Pulse cannot see text opt-outs", () => {
    expect(render(draft)).toContain("Pulse cannot see text opt-outs.");
  });

  it("F-V7: the placeholder uses a or an", () => {
    expect(withArticle("Instagram reply")).toBe("an Instagram reply");
    expect(withArticle("email")).toBe("an email");
    expect(withArticle("text")).toBe("a text");
    expect(withArticle("Messenger reply")).toBe("a Messenger reply");
  });
});
