import { describe, it, expect } from "vitest";
import { applyLinkInBioSuffix, LINK_IN_BIO } from "./link-in-bio";

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
