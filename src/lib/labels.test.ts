import { describe, it, expect } from "vitest";
import { serviceLabel } from "./labels";

/* A tour on the calendar should read "Tour", not "Custom". */
describe("serviceLabel", () => {
  it("title-cases the seven services", () => {
    expect(serviceLabel("recording")).toBe("Recording");
    expect(serviceLabel("mastering")).toBe("Mastering");
  });

  it("prints the studio's own name for a custom booking", () => {
    expect(serviceLabel("custom", "Tour")).toBe("Tour");
    expect(serviceLabel("custom", "  Maintenance day  ")).toBe("Maintenance day");
  });

  it("falls back to 'Custom' rather than an empty badge", () => {
    expect(serviceLabel("custom", "")).toBe("Custom");
    expect(serviceLabel("custom", "   ")).toBe("Custom");
    expect(serviceLabel("custom")).toBe("Custom");
  });

  it("ignores a stray label on a normal service", () => {
    expect(serviceLabel("mixing", "Tour")).toBe("Mixing");
  });

  it("says nothing when there is no service", () => {
    expect(serviceLabel(undefined)).toBe("");
    expect(serviceLabel(null)).toBe("");
  });
});
