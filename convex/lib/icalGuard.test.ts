import { describe, expect, it, vi } from "vitest";
import { checkIcalUrl, fetchFeed, lookupRefusal, type IcalHop } from "./icalGuard";

/* iCal feed import SSRF guard (pentest 2026-10-11, CWE-918). */

describe("iCal feed URL", () => {
  it("accepts an ordinary https feed", () => {
    expect(checkIcalUrl("https://calendar.google.com/calendar/ical/x/basic.ics").hostname).toBe("calendar.google.com");
  });

  it.each([
    ["http://example.com/cal.ics", "https"],
    ["https://user:pw@example.com/cal.ics", "login"],
    ["https://169.254.169.254/latest/", "non-public address"],
    ["https://2852039166/", "non-public address"], // the metadata address as one integer
    ["https://[::ffff:a9fe:a9fe]/", "non-public address"],
    ["https://localhost/cal.ics", "non-public host"],
    ["https://printer.local/cal.ics", "non-public host"],
    ["https://intranet/cal.ics", "non-public host"],
  ])("refuses %s", (url, why) => {
    expect(() => checkIcalUrl(url)).toThrow(why);
  });

  it("refuses a DNS answer with any private address, and an empty one", () => {
    expect(lookupRefusal([{ address: "93.184.216.34" }])).toBeNull();
    expect(lookupRefusal([{ address: "93.184.216.34" }, { address: "10.0.0.7" }])).toMatch(/non-public/);
    expect(lookupRefusal([{ address: "::ffff:7f00:1" }])).toMatch(/non-public/);
    expect(lookupRefusal([])).toMatch(/no address/);
  });
});

describe("iCal feed redirects", () => {
  const hops = (map: Record<string, IcalHop>) =>
    vi.fn(async (u: URL): Promise<IcalHop> => map[u.href] ?? { status: 404 });

  it("follows a redirect to another public https feed", async () => {
    const get = hops({
      "https://feeds.example.com/a.ics": { status: 302, location: "/b.ics" },
      "https://feeds.example.com/b.ics": { status: 200, body: "BEGIN:VCALENDAR" },
    });
    expect(await fetchFeed("https://feeds.example.com/a.ics", get)).toBe("BEGIN:VCALENDAR");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each(["http://169.254.169.254/latest/meta-data/", "https://10.0.0.5/", "https://[fd00::1]/", "https://localhost/"])(
    "refuses a redirect into %s without requesting it",
    async (target) => {
      const get = hops({ "https://feeds.example.com/a.ics": { status: 301, location: target } });
      await expect(fetchFeed("https://feeds.example.com/a.ics", get)).rejects.toThrow(/Calendar URL/);
      expect(get).toHaveBeenCalledTimes(1);
    },
  );

  it("stops after too many redirects and reports a failing status", async () => {
    const loop = vi.fn(async (): Promise<IcalHop> => ({ status: 302, location: "https://feeds.example.com/again.ics" }));
    await expect(fetchFeed("https://feeds.example.com/a.ics", loop)).rejects.toThrow(/too many/);
    await expect(fetchFeed("https://feeds.example.com/gone.ics", hops({}))).rejects.toThrow("HTTP 404");
  });
});
