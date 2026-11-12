import { describe, it, expect } from "vitest";
import { DEFAULT_HIDDEN, WIDGET_KEYS } from "./widget-registry";
import { normalizeLayout, visibleKeys } from "@/lib/dashboard-layout";

/* The plans sell a "today screen" (arrivals, balances, who is on, rooms busy
   until, tomorrow) and project cards on the home screen. A new studio's
   dashboard must show them without anyone opening the widget tray. */
describe("default dashboard", () => {
  const fresh = visibleKeys(normalizeLayout(null, WIDGET_KEYS, DEFAULT_HIDDEN));

  it("shows the Today board", () => {
    expect(fresh).toContain("today");
  });
});
