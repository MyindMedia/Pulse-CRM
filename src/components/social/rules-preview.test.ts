import { describe, it, expect } from "vitest";
import { previewWarnings, tightestCaptionLimit } from "./rules-preview";

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

describe("tightestCaptionLimit", () => {
  it("returns null when nothing is selected", () => {
    expect(tightestCaptionLimit([])).toBeNull();
  });

  it("picks the platform with the smallest limit, not the first or last", () => {
    // facebook (63,206) and instagram (2,200) both allow more than bluesky
    // (300), regardless of the order they were selected in.
    const out = tightestCaptionLimit([{ platform: "facebook" }, { platform: "bluesky" }, { platform: "instagram" }]);
    expect(out).toEqual({ platform: "bluesky", limit: 300 });
  });

  it("reports the single selected platform's own limit", () => {
    expect(tightestCaptionLimit([{ platform: "instagram" }])).toEqual({ platform: "instagram", limit: 2200 });
  });
});
