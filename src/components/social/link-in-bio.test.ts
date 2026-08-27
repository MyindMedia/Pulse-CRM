import { describe, it, expect } from "vitest";
import { applyLinkInBioSuffix, nextMixBaseline, LINK_IN_BIO } from "./link-in-bio";

describe("applyLinkInBioSuffix", () => {
  it("appends when every account is Instagram and the link is off", () => {
    const out = applyLinkInBioSuffix("Big session today", { allInstagramSelected: true, includeBookingLink: false });
    expect(out).toBe(`Big session today\n\n${LINK_IN_BIO}`);
  });

  it("does not append when the link is on, even if the mix is Instagram-only", () => {
    const out = applyLinkInBioSuffix("Big session today", { allInstagramSelected: true, includeBookingLink: true });
    expect(out).toBe("Big session today");
  });

  it("does not append when the mix is not Instagram-only", () => {
    const out = applyLinkInBioSuffix("Big session today", { allInstagramSelected: false, includeBookingLink: false });
    expect(out).toBe("Big session today");
  });

  it("does not duplicate on repeated calls with the same inputs", () => {
    const once = applyLinkInBioSuffix("Big session today", { allInstagramSelected: true, includeBookingLink: false });
    const twice = applyLinkInBioSuffix(once, { allInstagramSelected: true, includeBookingLink: false });
    expect(twice).toBe(once);
    expect(twice.split(LINK_IN_BIO).length - 1).toBe(1);
  });

  it("retracts the phrase when the mix later changes away from Instagram-only", () => {
    const withSuffix = applyLinkInBioSuffix("Big session today", { allInstagramSelected: true, includeBookingLink: false });
    const widened = applyLinkInBioSuffix(withSuffix, { allInstagramSelected: false, includeBookingLink: false });
    expect(widened).toBe("Big session today");
  });

  it("retracts the phrase when the owner turns the link back on", () => {
    const withSuffix = applyLinkInBioSuffix("Big session today", { allInstagramSelected: true, includeBookingLink: false });
    const linkOn = applyLinkInBioSuffix(withSuffix, { allInstagramSelected: true, includeBookingLink: true });
    expect(linkOn).toBe("Big session today");
  });

  it("is a no-op retracting a caption that never had the suffix", () => {
    const out = applyLinkInBioSuffix("No suffix here", { allInstagramSelected: false, includeBookingLink: true });
    expect(out).toBe("No suffix here");
  });

  it("leaves a manually-typed occurrence of the phrase alone when it is not the trailing auto-added one", () => {
    const caption = "Link in bio is a classic Instagram move.";
    const out = applyLinkInBioSuffix(caption, { allInstagramSelected: false, includeBookingLink: true });
    expect(out).toBe(caption);
  });
});

describe("nextMixBaseline", () => {
  it("does not reapply on the first settled mix (baseline capture is a no-op)", () => {
    expect(nextMixBaseline(null, true)).toEqual({ reapplyDefault: false, baseline: true });
    expect(nextMixBaseline(null, false)).toEqual({ reapplyDefault: false, baseline: false });
  });

  it("reapplies on a genuine transition from not-Instagram-only to Instagram-only", () => {
    expect(nextMixBaseline(false, true)).toEqual({ reapplyDefault: true, baseline: true });
  });

  it("reapplies on a genuine transition from Instagram-only to not-Instagram-only", () => {
    expect(nextMixBaseline(true, false)).toEqual({ reapplyDefault: true, baseline: false });
  });

  it("does not reapply when the mix has not actually changed", () => {
    expect(nextMixBaseline(true, true)).toEqual({ reapplyDefault: false, baseline: true });
    expect(nextMixBaseline(false, false)).toEqual({ reapplyDefault: false, baseline: false });
  });

  it("does not spuriously reapply when a null baseline follows a post switch", () => {
    // Composer resets the ref to null the moment a different post's data
    // lands, regardless of what the previous post's settled mix was - the
    // very next check must behave exactly like a fresh mount's first call,
    // not compare against the old post's baseline.
    const afterSwitch = nextMixBaseline(null, true);
    expect(afterSwitch.reapplyDefault).toBe(false);
    expect(afterSwitch.baseline).toBe(true);
  });
});
