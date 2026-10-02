import { describe, it, expect } from "vitest";
import { extractEmails, extractPhones, extractSocials, detectBooking, candidatePages, parseSeed, isGenericInbox, hostOf } from "./enrich";

const page = `
<html><body>
<a href="mailto:Studio@IceCreamSound.com?subject=Hi">Email</a>
<p>Bookings: booking [at] icecreamsound [dot] com</p>
<p>Press: pr@someagency.com</p>
<img src="logo@2x.png"><span>user@sentry.io</span><a href="mailto:noreply@icecreamsound.com">x</a>
<p>Call (323) 760-7557 or +1 323.555.0199</p>
<div style="width:1234567890px">12345678901234</div>
<a href="tel:+13235550142">call</a>
<a href="https://www.instagram.com/icecreamsound/">IG</a>
<a href="https://twitter.com/intent/tweet?text=x">share</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
<a href="https://www.tiktok.com/@icecream">TT</a>
<a href="https://ice.leadconnectorhq.com/widget/booking/abc">Book</a>
<a href="/contact">Contact</a><a href="/about-us/">About</a><a href="https://other.com/contact">off-site</a>
</body></html>`;

describe("enrich", () => {
  it("ranks a domain-matching studio inbox first and keeps others below it", () => {
    const e = extractEmails(page, "icecreamsound.com");
    expect(e[0].address).toBe("studio@icecreamsound.com");
    expect(e.map((x) => x.address)).toContain("booking@icecreamsound.com");
    expect(e.map((x) => x.address)).toContain("pr@someagency.com");
    const idxDomain = e.findIndex((x) => x.address === "booking@icecreamsound.com");
    const idxOther = e.findIndex((x) => x.address === "pr@someagency.com");
    expect(idxDomain).toBeLessThan(idxOther);
  });
  it("drops image names, tracker domains and no-reply addresses", () => {
    const addrs = extractEmails(page, "icecreamsound.com").map((x) => x.address).join(" ");
    expect(addrs).not.toMatch(/png|sentry|noreply/);
  });
  it("flags generic inboxes so they are not mistaken for a decision-maker", () => {
    expect(isGenericInbox("info@x.com")).toBe(true);
    expect(isGenericInbox("jane@x.com")).toBe(false);
    expect(extractEmails(page, "icecreamsound.com")[0].generic).toBe(true);
  });
  it("finds real US phones and ignores CSS-like digit runs", () => {
    const nums = extractPhones(page).map((p) => p.number);
    expect(nums).toContain("(323) 760-7557");
    expect(nums).toContain("(323) 555-0199");
    expect(nums).toContain("(323) 555-0142");
    expect(nums.join()).not.toMatch(/123456/);
  });
  it("collects profile links but not share buttons", () => {
    const s = extractSocials(page);
    expect(s.map((x) => x.url)).toContain("https://instagram.com/icecreamsound");
    expect(s.map((x) => x.url)).toContain("https://tiktok.com/@icecream");
    expect(s.some((x) => /intent|sharer/.test(x.url))).toBe(false);
  });
  it("detects booking platforms and picks only same-host contact pages", () => {
    expect(detectBooking(page)).toContain("GoHighLevel");
    const c = candidatePages(page, "https://icecreamsound.com/");
    expect(c).toEqual(["https://icecreamsound.com/contact", "https://icecreamsound.com/about-us"]);
  });
  it("hostOf strips www", () => {
    expect(hostOf("https://www.Foo.com/a")).toBe("foo.com");
  });
});

describe("parseSeed", () => {
  it("handles, profile links, post links and websites", () => {
    expect(parseSeed("@IceCreamSound")).toMatchObject({ handle: "icecreamsound", dedupeKey: "ig:icecreamsound" });
    expect(parseSeed("icecreamsound")).toMatchObject({ handle: "icecreamsound" });
    expect(parseSeed("https://www.instagram.com/icecreamsound/")).toMatchObject({ handle: "icecreamsound" });
    const post = parseSeed("https://www.instagram.com/p/ABC123/");
    expect(post?.handle).toBeUndefined();
    expect(post?.note).toMatch(/Post link/);
    expect(parseSeed("icecreamsound.com")).toMatchObject({ websiteUrl: "https://icecreamsound.com", dedupeKey: "site:icecreamsound.com" });
  });
  it("rejects blanks and junk", () => {
    expect(parseSeed("   ")).toBeNull();
    expect(parseSeed("not a url or handle!!")).toBeNull();
  });
});
