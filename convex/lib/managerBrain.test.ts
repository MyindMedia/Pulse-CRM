import { describe, it, expect } from "vitest";
import { assessStudio, type AssessInput } from "./managerBrain";

function base(): AssessInput {
  return {
    healthBand: "strong",
    healthScore: 88,
    profitOverall: 84,
    profitBand: "healthy",
    profitLevers: [],
    risks: [],
    graph: {
      topClients: [{ label: "Nova", degree: 6 }, { label: "Max", degree: 3 }],
      clientConcentration: { label: "Nova", share: 40 },
      engineerConcentration: { label: "Ava", share: 50 },
      idleGear: 0,
    },
  };
}

describe("assessStudio", () => {
  it("reads a healthy studio as on track with no priorities", () => {
    const a = assessStudio(base());
    expect(a.standing).toBe("on_track");
    expect(a.priorities).toHaveLength(0);
    expect(a.headline).toMatch(/On track/);
    expect(a.relationships[0]).toMatch(/Nova/);
  });

  it("flags at_risk on any critical risk", () => {
    const input = base();
    input.risks = [{ category: "splitsheets", severity: "critical", title: "Splits not executed - Track" }];
    const a = assessStudio(input);
    expect(a.standing).toBe("at_risk");
    expect(a.priorities[0].severity).toBe("critical");
  });

  it("flags watch on a warning profit lever and surfaces it as a priority", () => {
    const input = base();
    input.profitBand = "warning";
    input.profitLevers = [
      { label: "Room utilization", band: "warning", recommendation: "Fill idle rooms.", estImpactCents: 120000 },
    ];
    const a = assessStudio(input);
    expect(a.standing).toBe("watch");
    expect(a.priorities[0].title).toMatch(/room utilization/i);
    expect(a.priorities[0].why).toMatch(/\$1,200\/mo/);
  });

  it("ranks critical priorities ahead of warnings", () => {
    const input = base();
    input.profitLevers = [{ label: "Collection rate", band: "warning", recommendation: "Chase overdue." }];
    input.risks = [{ category: "studio_scheduling", severity: "critical", title: "Double-booked room" }];
    const a = assessStudio(input);
    expect(a.priorities[0].severity).toBe("critical");
    expect(a.priorities[0].title).toMatch(/Double-booked/);
  });

  it("adds a single-engineer-dependency priority from the graph", () => {
    const input = base();
    input.graph.engineerConcentration = { label: "Ava", share: 90 };
    const a = assessStudio(input);
    expect(a.priorities.some((p) => /single-engineer dependency/i.test(p.title))).toBe(true);
  });
});
