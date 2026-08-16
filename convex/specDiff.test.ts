import { describe, it, expect } from "vitest";
import { diffPorts, type ExistingPort } from "./lib/specLookup";
import { port } from "./lib/portTemplates";

/* A spec sheet meeting a device that is already patched. The only thing
   that really matters here is that nothing carrying a cable gets swept into
   the remove pile by accident. */

const existing = (label: string, direction: "input" | "output", patched = 0): ExistingPort => ({
  _id: `p_${label}_${direction}`,
  label,
  direction,
  signalLevel: "line",
  connector: "trs",
  patched,
});

describe("diffing a spec sheet against a device", () => {
  it("adds what the sheet found and the device lacks", () => {
    const d = diffPorts(
      [existing("Mic In 1", "input")],
      [
        port("Mic In 1", "input", "mic", "xlr3"),
        port("Mic In 2", "input", "mic", "xlr3"),
        port("ADAT In", "input", "digital", "adat_optical"),
      ],
    );
    expect(d.add.map((p) => p.label)).toEqual(["Mic In 2", "ADAT In"]);
    expect(d.keep).toHaveLength(1);
    expect(d.remove).toHaveLength(0);
  });

  // The same hole, spelled differently. Deleting and recreating it would
  // pull its cable for no reason at all.
  it("treats a jack as the same one across punctuation and case", () => {
    const d = diffPorts(
      [existing("Mic/Line In 1", "input")],
      [port("mic line in 1", "input", "mic", "xlr3")],
    );
    expect(d.keep).toHaveLength(1);
    expect(d.add).toHaveLength(0);
    expect(d.remove).toHaveLength(0);
  });

  it("keeps a jack whose connector was guessed wrong, rather than replacing it", () => {
    // Existing says TRS, the sheet says XLR. Same label, same direction.
    const d = diffPorts(
      [existing("Line In 1", "input")],
      [port("Line In 1", "input", "line", "xlr3")],
    );
    expect(d.keep).toHaveLength(1);
    expect(d.remove).toHaveLength(0);
  });

  it("lists what the sheet never mentioned, and says what is patched into it", () => {
    const d = diffPorts(
      [existing("Mic In 1", "input"), existing("Mystery Out", "output", 2)],
      [port("Mic In 1", "input", "mic", "xlr3")],
    );
    expect(d.remove.map((p) => p.label)).toEqual(["Mystery Out"]);
    expect(d.remove[0].patched).toBe(2);
  });

  // Direction is part of identity: an input and an output can share a name
  // on a panel and they are not the same jack.
  it("does not match an input against an output of the same name", () => {
    const d = diffPorts(
      [existing("Word Clock", "input")],
      [port("Word Clock", "output", "control", "wordclock_bnc")],
    );
    expect(d.add).toHaveLength(1);
    expect(d.remove).toHaveLength(1);
  });

  it("pairs a bank one for one rather than collapsing it", () => {
    const d = diffPorts(
      [existing("In 1", "input"), existing("In 2", "input")],
      [
        port("In 1", "input", "line", "trs"),
        port("In 2", "input", "line", "trs"),
        port("In 3", "input", "line", "trs"),
      ],
    );
    expect(d.keep).toHaveLength(2);
    expect(d.add.map((p) => p.label)).toEqual(["In 3"]);
    expect(d.remove).toHaveLength(0);
  });

  it("proposes everything when the device has no ports yet", () => {
    const d = diffPorts([], [port("In 1", "input", "mic", "xlr3")]);
    expect(d.add).toHaveLength(1);
    expect(d.remove).toHaveLength(0);
  });
});
