import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  APP_ROUTE_SEGMENTS,
  BOOT_CACHE_MAX_BYTES,
  BOOT_CACHE_VERSION,
  type BootRecord,
  type BootStorage,
  bootCacheKey,
  bootThemeScript,
  clearBootCache,
  queryKey,
  readBootRecord,
  sanitizeForCache,
  sanitizeTheme,
  writeBootRecord,
} from "./boot-cache";
import { BootSnapshotStore } from "./boot-snapshot";

/** An in-memory Storage with switches for the failure modes browsers have. */
function memoryStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean; throwOnKey?: boolean } = {}) {
  const map = new Map<string, string>();
  const s: BootStorage & { map: Map<string, string> } = {
    map,
    get length() {
      return map.size;
    },
    key(i) {
      if (opts.throwOnKey) throw new Error("SecurityError");
      return [...map.keys()][i] ?? null;
    },
    getItem(k) {
      if (opts.throwOnGet) throw new Error("SecurityError");
      return map.get(k) ?? null;
    },
    setItem(k, v) {
      if (opts.throwOnSet) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem(k) {
      map.delete(k);
    },
  };
  return s;
}

function record(over: Partial<BootRecord> = {}): BootRecord {
  return {
    v: BOOT_CACHE_VERSION,
    userId: "user_a",
    orgId: "org_1",
    savedAt: 1,
    queries: { [queryKey("today:today", {})]: { counts: { sessionsToday: 3 } } },
    ...over,
  };
}

describe("boot cache: scoping", () => {
  it("reads back only for the same user", () => {
    const s = memoryStorage();
    expect(writeBootRecord(s, record())).toBe(true);
    expect(readBootRecord(s, "user_a")?.queries).toEqual(record().queries);
    expect(readBootRecord(s, "user_b")).toBeNull();
  });

  it("keys each person separately", () => {
    expect(bootCacheKey("user_a")).not.toEqual(bootCacheKey("user_b"));
    expect(bootCacheKey("user_a")).toContain(`v${BOOT_CACHE_VERSION}`);
  });

  it("drops a record for another org once the live org is known", () => {
    const s = memoryStorage();
    writeBootRecord(s, record({ orgId: "org_1" }));
    expect(readBootRecord(s, "user_a", "org_1")).not.toBeNull();
    expect(readBootRecord(s, "user_a", "org_2")).toBeNull();
    // ...and it is gone from storage, not just hidden.
    expect(s.map.has(bootCacheKey("user_a"))).toBe(false);
  });

  it("a record stored under one key but naming another user is deleted", () => {
    const s = memoryStorage();
    s.setItem(bootCacheKey("user_a"), JSON.stringify(record({ userId: "user_b" })));
    expect(readBootRecord(s, "user_a")).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it("never writes without a user and an org", () => {
    const s = memoryStorage();
    expect(writeBootRecord(s, record({ userId: "" }))).toBe(false);
    expect(writeBootRecord(s, record({ orgId: "" }))).toBe(false);
    expect(s.map.size).toBe(0);
  });
});

describe("boot cache: wipe", () => {
  it("sign-out (no keeper) removes every boot record and nothing else", () => {
    const s = memoryStorage();
    writeBootRecord(s, record({ userId: "user_a" }));
    writeBootRecord(s, record({ userId: "user_b" }));
    s.setItem("pulse:boot:v0:user_a", "old");
    s.setItem("pulse-theme", "dark");
    clearBootCache(s);
    expect([...s.map.keys()]).toEqual(["pulse-theme"]);
  });

  it("account switch keeps only the current person's record", () => {
    const s = memoryStorage();
    writeBootRecord(s, record({ userId: "user_a" }));
    writeBootRecord(s, record({ userId: "user_b" }));
    clearBootCache(s, "user_b");
    expect(readBootRecord(s, "user_a")).toBeNull();
    expect(readBootRecord(s, "user_b")).not.toBeNull();
  });

  it("opening the store as a new person wipes the previous person's record", () => {
    const s = memoryStorage();
    writeBootRecord(s, record({ userId: "user_a" }));
    const store = new BootSnapshotStore("user_b", s);
    expect(store.hasData()).toBe(false);
    expect(s.map.has(bootCacheKey("user_a"))).toBe(false);
  });

  it("an org switch drops the old studio's record from the store and storage", () => {
    const s = memoryStorage();
    writeBootRecord(s, record({ orgId: "org_1" }));
    const store = new BootSnapshotStore("user_a", s);
    expect(store.hasData()).toBe(true);
    store.setOrg("org_2");
    expect(store.hasData()).toBe(false);
    expect(s.map.has(bootCacheKey("user_a"))).toBe(false);
  });

  it("records live answers under the live org", () => {
    const s = memoryStorage();
    const store = new BootSnapshotStore("user_a", s);
    store.put("today:{}", { counts: { sessionsToday: 5 } });
    store.flush(); // no org yet: nothing written
    expect(s.map.size).toBe(0);
    store.setOrg("org_9");
    store.flush();
    const back = readBootRecord(s, "user_a", "org_9");
    expect(back?.queries["today:{}"]).toEqual({ counts: { sessionsToday: 5 } });
  });
});

describe("boot cache: version and corruption", () => {
  it("a record from another schema version is deleted", () => {
    const s = memoryStorage();
    s.setItem(bootCacheKey("user_a"), JSON.stringify({ ...record(), v: BOOT_CACHE_VERSION + 1 }));
    expect(readBootRecord(s, "user_a")).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it("corrupt JSON is deleted, not thrown", () => {
    const s = memoryStorage();
    s.setItem(bootCacheKey("user_a"), "{not json");
    expect(readBootRecord(s, "user_a")).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it("a record with the wrong shape is deleted", () => {
    const s = memoryStorage();
    s.setItem(bootCacheKey("user_a"), JSON.stringify({ v: BOOT_CACHE_VERSION, userId: "user_a", orgId: "o", savedAt: 1, queries: [] }));
    expect(readBootRecord(s, "user_a")).toBeNull();
  });
});

describe("boot cache: storage that throws", () => {
  it("reads as no cache when getItem throws", () => {
    expect(readBootRecord(memoryStorage({ throwOnGet: true }), "user_a")).toBeNull();
  });

  it("reports nothing written when setItem throws (quota, private mode)", () => {
    expect(writeBootRecord(memoryStorage({ throwOnSet: true }), record())).toBe(false);
  });

  it("clearing survives a storage that throws on enumeration", () => {
    expect(() => clearBootCache(memoryStorage({ throwOnKey: true }))).not.toThrow();
  });

  it("no storage at all is a no-op everywhere", () => {
    expect(readBootRecord(null, "user_a")).toBeNull();
    expect(writeBootRecord(null, record())).toBe(false);
    expect(() => clearBootCache(null)).not.toThrow();
    const store = new BootSnapshotStore("user_a", null);
    store.put("k", 1);
    store.setOrg("org_1");
    expect(() => store.flush()).not.toThrow();
  });

  it("a record over the size cap is not written", () => {
    const s = memoryStorage();
    const big = record({ queries: { k: "x".repeat(4000) } });
    for (let i = 0; i < Math.ceil(BOOT_CACHE_MAX_BYTES / 4000) + 2; i++) big.queries[`k${i}`] = "x".repeat(4000);
    expect(writeBootRecord(s, big)).toBe(false);
    expect(s.map.size).toBe(0);
  });
});

describe("boot cache: what may be stored", () => {
  it("strips contact and payment fields at any depth", () => {
    const clean = sanitizeForCache({
      name: "Nova",
      clientEmail: "nova@example.test",
      phone: "+13105550123",
      card: { last4: "4242", brand: "visa" },
      sessions: [{ title: "Tracking", clientPhone: "555", paymentMethodId: "pm_1", amountCents: 1000 }],
    });
    expect(clean).toEqual({ name: "Nova", sessions: [{ title: "Tracking", amountCents: 1000 }] });
  });

  it("writes the stripped form to storage", () => {
    const s = memoryStorage();
    writeBootRecord(s, record({ queries: { q: { artistName: "Aurora", artistEmail: "a@b.test" } } }));
    const raw = s.getItem(bootCacheKey("user_a"))!;
    expect(raw).not.toContain("a@b.test");
    expect(raw).toContain("Aurora");
  });

  it("query keys ignore argument order", () => {
    expect(queryKey("dashboard:periodKpis", { start: 1, end: 2 })).toEqual(queryKey("dashboard:periodKpis", { end: 2, start: 1 }));
    expect(queryKey("today:today", undefined)).toEqual(queryKey("today:today", {}));
  });

  it("theme keeps only well-formed tokens, attributes and Google Fonts URLs", () => {
    const t = sanitizeTheme({
      vars: { "--color-gold": "#ff8800", "--x": "red;} body{display:none", "color": "red", "--brand-rgb": "255 136 0" },
      attrs: { uiStyle: "glass", brandTheme: "on", themeMode: "<script>" },
      fonts: ["https://fonts.googleapis.com/css2?family=Inter", "https://evil.test/x.css"],
    });
    expect(t).toEqual({
      vars: { "--color-gold": "#ff8800", "--brand-rgb": "255 136 0" },
      attrs: { uiStyle: "glass", brandTheme: "on" },
      fonts: ["https://fonts.googleapis.com/css2?family=Inter"],
    });
  });
});

describe("boot cache: first-paint script", () => {
  function run(userId: string, stored: string | null, pathname = "/dashboard") {
    const appended: { tag: string; id?: string; textContent?: string; href?: string }[] = [];
    const dataset: Record<string, string> = {};
    const doc = {
      documentElement: { dataset },
      head: { appendChild: (el: (typeof appended)[number]) => appended.push(el) },
      createElement: (tag: string) => ({ tag }),
    };
    const ls = { getItem: () => stored };
    new Function("localStorage", "document", "location", bootThemeScript(userId))(ls, doc, { pathname });
    return { appended, dataset };
  }

  it("paints the cached theme for the same person", () => {
    const stored = JSON.stringify(
      record({ theme: { vars: { "--color-gold": "#ff8800" }, attrs: { uiStyle: "glass" }, fonts: [] } }),
    );
    const { appended, dataset } = run("user_a", stored);
    expect(appended[0]?.textContent).toBe("html:root{--color-gold:#ff8800 !important;}");
    expect(dataset.uiStyle).toBe("glass");
  });

  it("ignores another person's record and anything malformed", () => {
    const theirs = JSON.stringify(record({ userId: "user_b", theme: { vars: { "--color-gold": "#000" }, attrs: {}, fonts: [] } }));
    expect(run("user_a", theirs).appended).toEqual([]);
    expect(run("user_a", "{broken").appended).toEqual([]);
    expect(run("user_a", null).appended).toEqual([]);
    const evil = JSON.stringify(record({ theme: { vars: { "--x": "}</style><script>" }, attrs: { uiStyle: "a b" }, fonts: ["javascript:alert(1)"] } }));
    const r = run("user_a", evil);
    expect(r.appended).toEqual([]);
    expect(r.dataset).toEqual({});
  });

  it("never paints on public pages, which carry their own studio's brand", () => {
    const stored = JSON.stringify(record({ theme: { vars: { "--color-gold": "#ff8800" }, attrs: { uiStyle: "glass" }, fonts: [] } }));
    for (const p of ["/book/myind", "/visit/x", "/kiosk", "/", "/sign-in", "/portal/t"]) {
      expect(run("user_a", stored, p).appended).toEqual([]);
    }
    expect(run("user_a", stored, "/calendar").appended).toHaveLength(1);
  });

  it("knows every app route (src/app/(app)) and nothing else", () => {
    const dir = path.resolve(__dirname, "../app/(app)");
    const segments = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect([...APP_ROUTE_SEGMENTS].sort()).toEqual(segments);
  });

  it("is empty with no signed-in person and escapes the user id", () => {
    expect(bootThemeScript(null)).toBe("");
    expect(bootThemeScript("</script><script>alert(1)")).not.toContain("</script>");
  });
});
