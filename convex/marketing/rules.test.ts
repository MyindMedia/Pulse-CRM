import { describe, it, expect } from "vitest";
import { validateForPlatform, captionLimit } from "./rules";

describe("platform rules", () => {
  it("tiktok and youtube require exactly one video", () => {
    expect(validateForPlatform("tiktok", { caption: "x", media: ["image"], hasLink: false })).toContain("TikTok needs one video.");
    expect(validateForPlatform("youtube", { caption: "x", media: [], hasLink: false })).toContain("YouTube needs one video.");
    expect(validateForPlatform("tiktok", { caption: "x", media: ["video"], hasLink: false })).toEqual([]);
  });
  it("instagram needs media and allows up to ten images", () => {
    expect(validateForPlatform("instagram", { caption: "x", media: [], hasLink: false })).toContain("Instagram needs a photo or video.");
    expect(validateForPlatform("instagram", { caption: "x", media: Array(11).fill("image"), hasLink: false })).toContain("Instagram allows up to 10 photos.");
  });
  it("google rejects phone numbers and long captions", () => {
    expect(validateForPlatform("google", { caption: "Call 213-444-5199", media: ["image"], hasLink: false })).toContain("Google rejects phone numbers in the text. Use the call button instead.");
    expect(validateForPlatform("google", { caption: "a".repeat(1501), media: [], hasLink: false })).toContain("Google allows 1,500 characters.");
  });
  it("caption limits", () => {
    expect(captionLimit("bluesky")).toBe(300);
    expect(captionLimit("threads")).toBe(500);
    expect(captionLimit("instagram")).toBe(2200);
  });
  it("facebook and linkedin accept text only", () => {
    expect(validateForPlatform("facebook", { caption: "hi", media: [], hasLink: true })).toEqual([]);
    expect(validateForPlatform("linkedin", { caption: "hi", media: [], hasLink: true })).toEqual([]);
  });
});
