import { describe, it, expect } from "vitest";
import { previewWarnings } from "./rules-preview";

describe("previewWarnings", () => {
  it("only returns accounts with at least one problem", () => {
    const accounts = [
      { _id: "a1", platform: "instagram" as const },
      { _id: "a2", platform: "facebook" as const },
    ];
    const out = previewWarnings(accounts, { caption: "hi", media: [], hasLink: false });
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe("a1");
    expect(out[0].problems[0]).toMatch(/Instagram needs a photo or video/);
  });

  it("returns nothing when every account is fine", () => {
    const accounts = [{ _id: "a1", platform: "facebook" as const }];
    const out = previewWarnings(accounts, { caption: "hi", media: ["image"], hasLink: false });
    expect(out).toEqual([]);
  });

  it("carries every account's own platform label into its warning", () => {
    const accounts = [
      { _id: "a1", platform: "tiktok" as const },
      { _id: "a2", platform: "youtube" as const },
    ];
    const out = previewWarnings(accounts, { caption: "hi", media: ["image"], hasLink: false });
    expect(out.map((w) => w.platform).sort()).toEqual(["tiktok", "youtube"]);
  });
});
