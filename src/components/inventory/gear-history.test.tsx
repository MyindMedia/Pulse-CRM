// @vitest-environment node
/* "Pulse keeps the history on the item" and "assign a label": the equipment
   dialog shows who had the item and when, and lets an editor set its code. */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = { locked: [] as string[], canEdit: true };

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      const name = getFunctionName(ref);
      if (name === "orgs:current") return { tierLockedFeatures: state.locked };
      if (name === "gearCheckout:history") {
        if (args === "skip") return undefined;
        return [
          { _id: "c2", holderLabel: "Maya Mixwell", outAt: Date.UTC(2026, 10, 10, 15), overdue: true },
          { _id: "c1", holderLabel: "Nova (session)", outAt: Date.UTC(2026, 10, 1, 15), inAt: Date.UTC(2026, 10, 2, 15), overdue: false },
        ];
      }
      throw new Error(`unexpected query ${name}`);
    },
    useMutation: () => vi.fn(),
  };
});

vi.mock("@/lib/use-capabilities", () => ({
  useCapabilities: () => ({ loaded: true, can: (c: string) => c === "equipment.edit" && state.canEdit }),
}));

const { GearHistory } = await import("./gear-history");
const render = () => renderToStaticMarkup(<GearHistory equipmentId={"e1" as never} barcode="PL-0001" />);

describe("GearHistory", () => {
  it("lists every check-out of the item, open and returned", () => {
    state.locked = []; state.canEdit = true;
    const html = render();
    expect(html).toContain("Check-out history");
    expect(html).toContain("Maya Mixwell");
    expect(html).toContain("Overdue");
    expect(html).toContain("Nova (session)");
  });

  it("lets an editor assign a label code", () => {
    state.locked = []; state.canEdit = true;
    expect(render()).toContain("Label code");
    state.canEdit = false;
    expect(render()).not.toContain("Label code");
  });

  it("lets an editor make a code for gear with no label yet", () => {
    state.locked = []; state.canEdit = true;
    const html = renderToStaticMarkup(<GearHistory equipmentId={"e1" as never} barcode={null} />);
    const button = html.match(/<button[^>]*>[^<]*Make one[^<]*<\/button>/)?.[0] ?? "";
    expect(button).not.toBe("");
    expect(button).not.toMatch(/\sdisabled=""/);
    // An item that already has this code has nothing to save.
    const same = render().match(/<button[^>]*>[^<]*Assign[^<]*<\/button>/)?.[0] ?? "";
    expect(same).toMatch(/\sdisabled=""/);
  });

  it("renders nothing without gear check-out on the plan", () => {
    state.locked = ["gearCheckout"];
    expect(render()).toBe("");
  });
});
