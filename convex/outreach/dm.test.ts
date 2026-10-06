import { describe, it, expect } from "vitest";
import { draftDm, dmBlockers, dmLink, observationFrom, DM_MAX_CHARS, DM_COOLDOWN_MS } from "./dm";

describe("DM drafting", () => {
  it("uses one true observation from the studio's own bio", () => {
    expect(observationFrom({ bio: "Mixing & mastering for indie artists" })).toBe("mixing and mastering");
    expect(observationFrom({ category: "Music Production Studio" })).toBe("music production studio");
    expect(observationFrom({ bio: "hello" })).toBeUndefined();
  });

  it("drafts a short DM with no link, no dash, a clear way to say no, and passes its own checks", () => {
    const { text, observation } = draftDm({ handle: "mixrec", studio: "MIX Recording Studio", bio: "We mix and master" });
    expect(observation).toBe("mixing and mastering");
    expect(text).toContain("MIX Recording Studio");
    expect(text).toMatch(/say stop/i);
    expect(text).not.toMatch(/[–—]|https?:/);
    expect(text.length).toBeLessThan(DM_MAX_CHARS);
    expect(dmBlockers({ text, handle: "mixrec", optedOut: false, now: 1 })).toEqual([]);
  });

  it("falls back to the handle and a generic compliment without inventing facts", () => {
    const { text, observation } = draftDm({ handle: "acme" });
    expect(observation).toBeUndefined();
    expect(text).toContain("acme");
    expect(text).not.toMatch(/focus on/);
  });

  it("blocks opt-outs, repeats inside 30 days, links, empty and over-long text", () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    expect(dmBlockers({ text: "hi", handle: "a", optedOut: true, now })[0]).toMatch(/not to be contacted/);
    expect(dmBlockers({ text: "hi", handle: "a", optedOut: false, lastSentAt: now - DM_COOLDOWN_MS / 2, now })[0]).toMatch(/15 more days/);
    expect(dmBlockers({ text: "hi", handle: "a", optedOut: false, lastSentAt: now - DM_COOLDOWN_MS - 1, now })).toEqual([]);
    expect(dmBlockers({ text: "see pulse.com now", handle: "a", optedOut: false, now })[0]).toMatch(/links/);
    expect(dmBlockers({ text: " ", handle: "a", optedOut: false, now })[0]).toMatch(/empty/);
    expect(dmBlockers({ text: "x".repeat(DM_MAX_CHARS + 1), handle: "a", optedOut: false, now })[0]).toMatch(/over/);
    expect(dmBlockers({ text: "hi", handle: null, optedOut: false, now })[0]).toMatch(/no Instagram handle/);
  });

  it("builds the ig.me deep link", () => {
    expect(dmLink("MixRec")).toBe("https://ig.me/m/mixrec");
  });
});
