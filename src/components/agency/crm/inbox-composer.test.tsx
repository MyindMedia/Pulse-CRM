import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as React from "react";

/* X-02 / confirm gate: nothing in the composer sends on its own. Every write
   button is pressed; only ConfirmDialog's onConfirm(grant) reaches send_message,
   and it carries confirm plus the draft's one idempotency key. */

type Props = Record<string, unknown>;
const captured: { buttons: Props[]; dialogs: Props[] } = { buttons: [], dialogs: [] };
const run = vi.fn(async (op: string, args?: unknown) => {
  void op; void args;
  return { ok: true, status: 200, limits: {}, data: { replies: [] } };
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
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }) }));

import { InboxComposer } from "./inbox-composer";
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
});
