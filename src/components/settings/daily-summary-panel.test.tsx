// @vitest-environment node
/* The daily summary is only sent while the assistant is on. With the assistant
   off the card must not read "on" (R44). */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = { policy: { enabled: true, digestEnabled: true, digestHourLocal: 8 } };

vi.mock("convex/react", () => ({
  useQuery: () => state.policy,
  useMutation: () => vi.fn(),
}));
vi.mock("@/lib/use-capabilities", () => ({
  useCapabilities: () => ({ loaded: true, can: () => true }),
}));

const { DailySummaryPanel, digestSwitchState } = await import("./daily-summary-panel");
const switchTag = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";

describe("daily summary switch", () => {
  it("reads off and locked while the assistant is off, whatever digestEnabled holds", () => {
    expect(digestSwitchState({ enabled: false, digestEnabled: true })).toEqual({ checked: false, locked: true, paused: true });
    expect(digestSwitchState({ enabled: true, digestEnabled: true })).toEqual({ checked: true, locked: false, paused: false });
    expect(digestSwitchState({ enabled: true, digestEnabled: false })).toEqual({ checked: false, locked: false, paused: false });
  });

  it("renders unchecked, disabled and explains why when the assistant is off", () => {
    state.policy = { enabled: false, digestEnabled: true, digestHourLocal: 8 };
    const html = renderToStaticMarkup(<DailySummaryPanel timezone="America/New_York" />);
    const sw = switchTag(html);
    expect(sw).toContain('aria-checked="false"');
    expect(sw).toMatch(/\sdisabled=""/);
    expect(html).toContain("The daily summary is paused because the assistant is turned off.");
  });

  it("renders the saved setting when the assistant is on", () => {
    state.policy = { enabled: true, digestEnabled: true, digestHourLocal: 8 };
    const html = renderToStaticMarkup(<DailySummaryPanel timezone="America/New_York" />);
    const sw = switchTag(html);
    expect(sw).toContain('aria-checked="true"');
    expect(sw).not.toMatch(/\sdisabled=""/);
    expect(html).not.toContain("paused");
  });
});
