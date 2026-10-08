import { describe, it, expect } from "vitest";
import { checkLocalPart, checkDisplayName, bareAddress, displayNameOf, ownAddress, routeRecipients, quarantinedRecipient } from "./address";

describe("checkLocalPart (new inbox)", () => {
  it("accepts lowercase a-z0-9._- and fixes the domain", () => {
    expect(checkLocalPart("booking.team_1-a")).toEqual({ ok: true, localPart: "booking.team_1-a", address: "booking.team_1-a@studiopulse.tech" });
    expect(checkLocalPart("hello@studiopulse.tech")).toMatchObject({ ok: true, address: "hello@studiopulse.tech" });
  });

  it("refuses uppercase, spaces, other characters and other domains", () => {
    for (const bad of ["Hello", "a b", "a+b", "a!b", "über", "x@gmail.com", ""]) {
      expect(checkLocalPart(bad).ok, bad).toBe(false);
    }
  });

  it("refuses leading or trailing punctuation, double dots and long names", () => {
    for (const bad of [".a", "a.", "-a", "a_", "a..b", "a".repeat(65)]) expect(checkLocalPart(bad).ok, bad).toBe(false);
  });

  it("refuses reserved names", () => {
    for (const r of ["postmaster", "abuse", "hostmaster", "webmaster", "security", "noreply", "mailer-daemon"]) {
      const out = checkLocalPart(r);
      expect(out.ok, r).toBe(false);
      if (!out.ok) expect(out.error).toMatch(/reserved/);
    }
  });

  it("display names are trimmed, capped and stripped of header specials", () => {
    expect(checkDisplayName("  Bookings  Team ")).toEqual({ ok: true, value: "Bookings Team" });
    expect(checkDisplayName("Evil\r\nBcc: x")).toEqual({ ok: true, value: "Evil Bcc: x" });
    expect(checkDisplayName("").ok).toBe(false);
    expect(checkDisplayName("x".repeat(61)).ok).toBe(false);
  });
});

describe("addresses", () => {
  it("parses bare addresses and names", () => {
    expect(bareAddress("Jane Doe <Jane@Example.com>")).toBe("jane@example.com");
    expect(bareAddress("jane@example.com")).toBe("jane@example.com");
    expect(bareAddress("not an address")).toBeNull();
    expect(displayNameOf('"Jane Doe" <jane@example.com>')).toBe("Jane Doe");
    expect(displayNameOf("jane@example.com")).toBeNull();
  });

  it("ownAddress keeps only our domain and drops +tags", () => {
    expect(ownAddress("Support <Support+abc@studiopulse.tech>")).toBe("support@studiopulse.tech");
    expect(ownAddress("someone@gmail.com")).toBeNull();
  });
});

describe("routeRecipients", () => {
  const active = new Set(["support@studiopulse.tech", "lawrenceb@studiopulse.tech"]);

  it("routes by envelope recipient first (covers Bcc)", () => {
    const r = routeRecipients({ receivedFor: ["lawrenceb@studiopulse.tech"], to: ["support@studiopulse.tech"] }, active);
    expect(r.address).toBe("lawrenceb@studiopulse.tech");
  });

  it("falls back to To then Cc", () => {
    expect(routeRecipients({ to: ["a@x.com", "Support <support@studiopulse.tech>"] }, active).address).toBe("support@studiopulse.tech");
    expect(routeRecipients({ to: ["a@x.com"], cc: ["lawrenceb@studiopulse.tech"] }, active).address).toBe("lawrenceb@studiopulse.tech");
  });

  it("unknown recipient in our domain is unrouted, with the candidate kept", () => {
    const r = routeRecipients({ to: ["sales@studiopulse.tech"] }, active);
    expect(r).toEqual({ address: null, candidates: ["sales@studiopulse.tech"] });
  });
});

describe("quarantinedRecipient", () => {
  it("flags role addresses that control the domain (certificate and registrar mail)", () => {
    for (const lp of ["admin", "administrator", "postmaster", "hostmaster", "abuse", "webmaster"]) {
      expect(quarantinedRecipient([`${lp}@studiopulse.tech`])).toBe(`${lp}@studiopulse.tech`);
    }
  });
  it("flags a reserved address even when an unknown one rides along", () => {
    expect(quarantinedRecipient(["sales@studiopulse.tech", "admin@studiopulse.tech"])).toBe("admin@studiopulse.tech");
  });
  it("leaves ordinary unrouted addresses alone", () => {
    expect(quarantinedRecipient(["sales@studiopulse.tech"])).toBeNull();
    expect(quarantinedRecipient([])).toBeNull();
  });
});
