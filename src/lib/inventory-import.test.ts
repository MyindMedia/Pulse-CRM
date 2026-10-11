import { describe, it, expect } from "vitest";
import {
  autoMapHeaders,
  coerceCategory,
  coerceStatus,
  coerceMoneyCents,
  coerceDateMs,
  isKnownCategory,
  rowToAsset,
  toImportItems,
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

describe("unrecognised categories (where a suggestion can help)", () => {
  it("isKnownCategory accepts valid names and aliases, not blanks or unknown text", () => {
    expect(isKnownCategory("mic")).toBe(true);
    expect(isKnownCategory("Microphone")).toBe(true);
    expect(isKnownCategory("other")).toBe(true); // the owner chose it
    expect(isKnownCategory("")).toBe(false);
    expect(isKnownCategory("Dynamics")).toBe(false);
    expect(isKnownCategory("constructor")).toBe(false); // not an alias, whatever Object.prototype says
  });

  it("rowToAsset marks the row and keeps the unknown text, category still other", () => {
    expect(rowToAsset({ name: "DT 770", category: "" })).toMatchObject({ category: "other", categoryKnown: false, sheetCategory: undefined });
    expect(rowToAsset({ name: "SM57", category: " Dynamics " })).toMatchObject({ category: "other", categoryKnown: false, sheetCategory: "Dynamics" });
    expect(rowToAsset({ name: "U87", category: "Microphone" })).toMatchObject({ category: "mic", categoryKnown: true, sheetCategory: undefined });
  });
});

describe("toImportItems", () => {
  const assets = [
    rowToAsset({ name: "DT 770", category: "", purchaseValue: "$159" })!,
    rowToAsset({ name: "Shure SM-57", category: "mic", room: "Studio A" })!,
    rowToAsset({ name: "Mystery box", category: "Widgets", status: "repair" })!,
  ];

  it("with no decisions, sends every row exactly as parsed", () => {
    expect(toImportItems(assets)).toEqual(
      assets.map((a) => ({
        name: a.name, category: a.category, purchaseCents: a.purchaseCents, currentValueCents: a.currentValueCents,
        serialNumber: a.serialNumber, condition: a.condition, notes: a.notes, status: a.status,
        purchaseDate: a.purchaseDate, roomName: a.roomName,
      })),
    );
  });

  it("applies only the categories the owner decided, and leaves out only the rows they skipped", () => {
    const items = toImportItems(assets, { categories: { 0: "headphones" }, skipped: new Set([1]) });
    expect(items.map((i) => [i.name, i.category])).toEqual([
      ["DT 770", "headphones"],
      ["Mystery box", "other"],
    ]);
  });
});
