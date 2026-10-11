// @vitest-environment node
/* The schedule's "Needs an engineer" panel with Jev suggestions. Off (no
   permission, no key, or a backend without the function) it renders exactly
   what it rendered before; on, it offers the button; a suggestion is a chip
   next to the engineer's name. */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const gate: { enabled: boolean | Error | undefined } = { enabled: false };

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "shifts:unstaffedSessions") {
        return [{ _id: "s1", title: "Nova vocals", startTime: 0, serviceType: "recording", roomName: "Studio A", clientName: "Nova" }];
      }
      if (name === "members:engineers") return [{ _id: "m1", name: "Maya Mixwell" }];
      throw new Error(`unexpected query ${name}`);
    },
    useQueries: () => ({ enabled: gate.enabled }),
    useMutation: () => vi.fn(),
    useAction: () => vi.fn(),
  };
});

const { UnstaffedSessions } = await import("./unstaffed-sessions");
const { SuggestedEngineers } = await import("./engineer-suggestions");

const render = () => renderToStaticMarkup(<UnstaffedSessions />);

describe("Needs an engineer: Jev suggestions", () => {
  it("renders today's panel, with no button, when suggestions are off or the backend lacks them", () => {
    gate.enabled = false;
    const off = render();
    expect(off).toContain("Nova vocals");
    expect(off).toContain("Assign engineer");
    expect(off).not.toContain("Suggest engineer");

    for (const state of [undefined, new Error("Could not find public function for 'jevEngineerFit:available'")]) {
      gate.enabled = state;
      expect(render()).toBe(off);
    }
  });

  it("offers the button to someone who may schedule staff", () => {
    gate.enabled = true;
    expect(render()).toContain("Suggest engineer");
  });

  it("shows a Suggested chip with the fit next to each suggested name, and says so when nobody fits", () => {
    const pick = {
      memberId: "m1", name: "Maya Mixwell", score: 2.76, fit: 0.92, confidence: 0.81,
      level: 3, label: "Ideal fit", suggested: true,
    } as never;
    const html = renderToStaticMarkup(<SuggestedEngineers result={{ key: "", picks: [pick] }} />);
    expect(html).toContain("Maya Mixwell");
    expect(html).toMatch(/Suggested · Ideal fit/);
    expect(html).toContain('title="Fit 2.8 of 3 · confidence 81%"');

    expect(renderToStaticMarkup(<SuggestedEngineers result={{ key: "", picks: [] }} />)).toContain("No clear fit");
  });
});
