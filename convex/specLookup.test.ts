import { describe, it, expect } from "vitest";
import { resolveSpec, normaliseConnector, specPrompt } from "./lib/specLookup";

/* The model is a research assistant, not a source of truth. These tests pin
   the boundary: what it is allowed to write into a patch map, and what gets
   thrown away before it can mislead an engineer standing at a rack. */

describe("what a spec lookup is allowed to write", () => {
  it("expands a bank into numbered, channel-indexed ports", () => {
    const out = resolveSpec(
      {
        confident: true,
        summary: "8 mic pres",
        ports: [
          {
            label: "Mic In",
            direction: "input",
            signalLevel: "mic",
            connector: "xlr3",
            count: 8,
            capabilities: ["phantom", "pad"],
          },
        ],
      },
      "interface",
    );

    expect(out.source).toBe("ai");
    expect(out.ports).toHaveLength(8);
    expect(out.ports[0].label).toBe("Mic In 1");
    expect(out.ports[7].label).toBe("Mic In 8");
    expect(out.ports[7].channelIndex).toBe(8);
    expect(out.ports[0].capabilities).toEqual(["phantom", "pad"]);
  });

  // An XLR output is male and an XLR input female. Recording that is what
  // lets the cable check catch two males later, so the lookup must stamp it.
  it("stamps the conventional gender the mating check relies on", () => {
    const out = resolveSpec(
      {
        ports: [
          { label: "Out", direction: "output", signalLevel: "line", connector: "xlr3" },
          { label: "In", direction: "input", signalLevel: "mic", connector: "xlr3" },
        ],
      },
      "preamp",
    );
    expect(out.ports[0].gender).toBe("male");
    expect(out.ports[1].gender).toBe("female");
  });

  it("drops a port whose connector is not in our vocabulary", () => {
    const out = resolveSpec(
      {
        ports: [
          { label: "Good", direction: "input", signalLevel: "line", connector: "trs" },
          { label: "Invented", direction: "input", signalLevel: "line", connector: "hyperjack" },
        ],
      },
      "preamp",
    );
    expect(out.source).toBe("ai");
    expect(out.ports).toHaveLength(1);
    expect(out.ports[0].label).toBe("Good");
    expect(out.rejected).toBe(1);
  });

  it("drops a port missing anything the connector check needs", () => {
    const out = resolveSpec(
      {
        ports: [
          { label: "Keep 1", direction: "output", signalLevel: "line", connector: "trs" },
          { label: "Keep 2", direction: "output", signalLevel: "line", connector: "trs" },
          { label: "Keep 3", direction: "input", signalLevel: "mic", connector: "xlr3" },
          { direction: "output", signalLevel: "line", connector: "trs" }, // no label
        ],
      },
      "preamp",
    );
    expect(out.source).toBe("ai");
    expect(out.ports.map((p) => p.label)).toEqual(["Keep 1", "Keep 2", "Keep 3"]);
    expect(out.rejected).toBe(1);
  });

  // A label, a level and a direction are each load-bearing on their own.
  it.each([
    ["no label", { direction: "output", signalLevel: "line", connector: "trs" }],
    ["no level", { label: "X", direction: "output", connector: "trs" }],
    ["no direction", { label: "X", signalLevel: "line", connector: "trs" }],
    ["no connector", { label: "X", direction: "output", signalLevel: "line" }],
  ])("refuses a port with %s", (_name, bad) => {
    const out = resolveSpec({ ports: [bad] }, "preamp");
    expect(out.source).toBe("category");
  });

  // Half-remembered I/O is the failure worth refusing: it looks specific and
  // is wrong, which is worse than an honest generic template.
  it("falls back to the category when most of the answer is garbage", () => {
    const out = resolveSpec(
      {
        ports: [
          { label: "Real", direction: "input", signalLevel: "mic", connector: "xlr3" },
          { label: "A", direction: "input", signalLevel: "mic", connector: "nonsense" },
          { label: "B", direction: "sideways", signalLevel: "mic", connector: "xlr3" },
          { label: "C", direction: "input", signalLevel: "vibes", connector: "xlr3" },
        ],
      },
      "mic",
    );
    expect(out.source).toBe("category");
    expect(out.rejected).toBe(3);
  });

  it("falls back when the model returns nothing usable", () => {
    expect(resolveSpec(null, "preamp").source).toBe("category");
    expect(resolveSpec({ ports: [] }, "preamp").source).toBe("category");
    expect(resolveSpec({}, "preamp").source).toBe("category");
  });

  it("refuses a runaway bank rather than minting hundreds of ports", () => {
    const out = resolveSpec(
      {
        ports: [
          { label: "Ch", direction: "input", signalLevel: "line", connector: "trs", count: 5000 },
        ],
      },
      "console",
    );
    expect(out.source).toBe("category");
  });

  it("keeps an unknown category placeable rather than failing", () => {
    const out = resolveSpec(null, "a-category-that-does-not-exist");
    expect(out.source).toBe("category");
    expect(out.ports.length).toBeGreaterThan(0);
  });
});

describe("connector spelling", () => {
  it("accepts our own vocabulary unchanged", () => {
    expect(normaliseConnector("xlr3")).toBe("xlr3");
    expect(normaliseConnector("usb_c")).toBe("usb_c");
  });

  it("resolves the spellings a model actually uses", () => {
    expect(normaliseConnector("XLR")).toBe("xlr3");
    expect(normaliseConnector("USB-C")).toBe("usb_c");
    expect(normaliseConnector("1/4 TRS")).toBe("trs");
    expect(normaliseConnector("TT")).toBe("bantam");
    expect(normaliseConnector("D-Sub")).toBe("db25");
    expect(normaliseConnector("word clock")).toBe("wordclock_bnc");
    expect(normaliseConnector("ADAT")).toBe("adat_optical");
  });

  // Models write panel labels the way a manual prints them. Dropping a jack
  // over a non-breaking hyphen would be a silly way to lose a USB port.
  it("survives the typography a real answer comes back with", () => {
    expect(normaliseConnector("USB\u2011C")).toBe("usb_c");
    expect(normaliseConnector("USB\u2013C")).toBe("usb_c");
    expect(normaliseConnector("XLR\u20113")).toBe("xlr3");
    expect(normaliseConnector("  usb-c  ")).toBe("usb_c");
    expect(normaliseConnector("USB\u00a0C")).toBe("usb_c");
  });

  // A combo jack is one hole taking XLR or a jack plug. We have no "accepts
  // either", and these are overwhelmingly used as mic inputs, so it is
  // recorded as XLR rather than dropped.
  it("records a combo jack as XLR rather than losing it", () => {
    expect(normaliseConnector('XLR/\u00bc" combo')).toBe("xlr3");
    expect(normaliseConnector("XLR / TRS Combo")).toBe("xlr3");
    expect(normaliseConnector("Combo XLR-1/4 inch")).toBe("xlr3");
  });

  it("refuses to guess at something it does not recognise", () => {
    expect(normaliseConnector("hyperjack")).toBeNull();
    // A DC inlet is not a signal connector and must never become one.
    expect(normaliseConnector("Barrel")).toBeNull();
    expect(normaliseConnector("DC power")).toBeNull();
    expect(normaliseConnector("")).toBeNull();
    expect(normaliseConnector(undefined)).toBeNull();
  });
});

describe("the prompt", () => {
  it("names the vocabulary and never offers the legacy catch-alls", () => {
    const prompt = specPrompt({
      name: "Scarlett 18i20",
      manufacturer: "Focusrite",
      category: "interface",
      note: "Rackmount 18-in/20-out",
    });
    expect(prompt).toContain("Focusrite Scarlett 18i20");
    expect(prompt).toContain("Rackmount 18-in/20-out");
    expect(prompt).toContain("xlr3");
    // "other" would let the model dodge the vocabulary entirely.
    expect(prompt).not.toMatch(/one of: .*\bother\b/);
  });
});
