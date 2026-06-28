import { describe, it, expect } from "vitest";
import {
  degreeMap,
  topByDegree,
  neighbors,
  concentrationShare,
  orphans,
  summarizeGraph,
  type GNode,
  type GEdge,
} from "./studioGraph";

const nodes: GNode[] = [
  { ref: "a1", kind: "artist", label: "Nova" },
  { ref: "a2", kind: "artist", label: "Max" },
  { ref: "s1", kind: "session", label: "Session 1" },
  { ref: "s2", kind: "session", label: "Session 2" },
  { ref: "e1", kind: "staff", label: "Ava" },
  { ref: "g1", kind: "gear", label: "Idle Mic" },
];
const edges: GEdge[] = [
  { fromRef: "a1", toRef: "s1", rel: "booked", weight: 1 },
  { fromRef: "a1", toRef: "s2", rel: "booked", weight: 1 },
  { fromRef: "a2", toRef: "s1", rel: "booked", weight: 1 },
  { fromRef: "s1", toRef: "e1", rel: "engineered_by", weight: 1 },
  { fromRef: "s2", toRef: "e1", rel: "engineered_by", weight: 1 },
];

describe("degreeMap", () => {
  it("credits both endpoints by edge weight", () => {
    const d = degreeMap(edges);
    expect(d.get("a1")).toBe(2); // two bookings
    expect(d.get("s1")).toBe(3); // two artists + one engineer
    expect(d.get("e1")).toBe(2);
  });
});

describe("topByDegree", () => {
  it("ranks artists by connection count", () => {
    const top = topByDegree(nodes, degreeMap(edges), { kind: "artist", limit: 5 });
    expect(top[0].node.ref).toBe("a1");
    expect(top[0].degree).toBe(2);
    expect(top[1].node.ref).toBe("a2");
  });
});

describe("neighbors", () => {
  it("returns connected refs with relationship + direction", () => {
    const n = neighbors("s1", edges);
    expect(n).toContainEqual({ ref: "a1", rel: "booked", weight: 1, dir: "in" });
    expect(n).toContainEqual({ ref: "e1", rel: "engineered_by", weight: 1, dir: "out" });
    expect(n).toHaveLength(3);
  });
});

describe("concentrationShare", () => {
  it("finds the largest share of a weighted total", () => {
    const m = new Map([
      ["x", 8],
      ["y", 2],
    ]);
    const c = concentrationShare(m);
    expect(c.topRef).toBe("x");
    expect(c.share).toBeCloseTo(0.8);
    expect(c.total).toBe(10);
  });
  it("is safe on an empty map", () => {
    expect(concentrationShare(new Map())).toEqual({ topRef: null, share: 0, total: 0 });
  });
});

describe("orphans", () => {
  it("finds entities with no edges", () => {
    const o = orphans(nodes, edges, "gear");
    expect(o.map((n) => n.ref)).toEqual(["g1"]);
  });
});

describe("summarizeGraph", () => {
  it("produces manager headline facts", () => {
    const s = summarizeGraph(nodes, edges);
    expect(s.nodeCount).toBe(6);
    expect(s.edgeCount).toBe(5);
    expect(s.countByKind.artist).toBe(2);
    expect(s.topClients[0].label).toBe("Nova");
    // Ava engineers both sessions -> 100% engineer concentration.
    expect(s.engineerConcentration.label).toBe("Ava");
    expect(s.engineerConcentration.share).toBe(100);
    expect(s.idleGear).toBe(1);
  });
});
