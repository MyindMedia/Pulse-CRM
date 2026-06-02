import { describe, it, expect } from "vitest";
import {
  autoMapHeaders,
  coerceCategory,
  coerceStatus,
  coerceMoneyCents,
  coerceDateMs,
  rowToAsset,
} from "./inventory-import";

describe("autoMapHeaders", () => {
  it("maps a clean template header row to the right fields", () => {
    const m = autoMapHeaders([
      "Name", "Category", "Purchase Value (USD)", "Current Value (USD)",
      "Serial Number", "Condition", "Location / Room", "Status", "Purchase Date", "Notes",
    ]);
    expect(m).toEqual([
      "name", "category", "purchaseValue", "currentValue",
      "serialNumber", "condition", "room", "status", "purchaseDate", "notes",
    ]);
  });

  it("discovers arbitrary column order + naming + casing", () => {
    const m = autoMapHeaders(["TYPE", "Item", "S/N", "cost", "worth", "where"]);
    expect(m).toEqual(["category", "name", "serialNumber", "purchaseValue", "currentValue", "room"]);
  });

  it("leaves unknown columns unmapped and never double-assigns a field", () => {
    const m = autoMapHeaders(["Name", "name again", "Color"]);
    expect(m[0]).toBe("name");
    expect(m[1]).toBeNull(); // name already claimed
    expect(m[2]).toBeNull(); // unknown
  });
});

describe("coercion", () => {
  it("coerceCategory maps aliases and defaults to other", () => {
    expect(coerceCategory("Microphone")).toBe("mic");
    expect(coerceCategory("MIXER")).toBe("console");
    expect(coerceCategory("guitar")).toBe("instrument");
    expect(coerceCategory("speakers")).toBe("monitor");
    expect(coerceCategory("widget")).toBe("other");
    expect(coerceCategory("")).toBe("other");
  });

  it("coerceStatus maps aliases and defaults to available", () => {
    expect(coerceStatus("In Use")).toBe("in_use");
    expect(coerceStatus("repair")).toBe("maintenance");
    expect(coerceStatus("sold")).toBe("retired");
    expect(coerceStatus("anything")).toBe("available");
  });

  it("coerceMoneyCents handles symbols, commas, numbers and junk", () => {
    expect(coerceMoneyCents("$3,200.50")).toBe(320050);
    expect(coerceMoneyCents(3200)).toBe(320000);
    expect(coerceMoneyCents("3200")).toBe(320000);
    expect(coerceMoneyCents("")).toBe(0);
    expect(coerceMoneyCents("n/a")).toBe(0);
  });

  it("coerceDateMs parses strings and Date objects, ignores junk", () => {
    expect(coerceDateMs("2023-05-14")).toBe(Date.parse("2023-05-14"));
    const d = new Date("2020-01-02");
    expect(coerceDateMs(d)).toBe(d.getTime());
    expect(coerceDateMs("")).toBeUndefined();
    expect(coerceDateMs("not a date")).toBeUndefined();
  });
});

describe("rowToAsset", () => {
  it("builds a clean asset and trims optionals", () => {
    const a = rowToAsset({
      name: "  Neumann U87 ", category: "Microphone", purchaseValue: "$3,200",
      currentValue: "2400", serialNumber: " U87-1 ", room: " Studio A ", status: "in use",
      notes: " mint ",
    });
    expect(a).toMatchObject({
      name: "Neumann U87", category: "mic", purchaseCents: 320000,
      currentValueCents: 240000, serialNumber: "U87-1", roomName: "Studio A",
      status: "in_use", notes: "mint",
    });
  });

  it("returns null when there is no name", () => {
    expect(rowToAsset({ category: "mic" })).toBeNull();
    expect(rowToAsset({ name: "   " })).toBeNull();
  });
});
