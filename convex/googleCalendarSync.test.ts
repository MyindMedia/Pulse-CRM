import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  mapGoogleEvent,
  parseGoogleTime,
  type MappedBlock,
} from "./googleCalendarSync";
import { PULSE_ORIGIN_TAG, type GoogleCalendarListEvent } from "./lib/google";

const ORG = "pulse-demo"; // demo viewer resolves to this org with owner caps

function ev(over: Partial<GoogleCalendarListEvent> = {}): GoogleCalendarListEvent {
  return {
    id: "g1",
    status: "confirmed",
    summary: "Outside booking",
    start: { dateTime: "2026-06-02T15:00:00.000Z" },
    end: { dateTime: "2026-06-02T17:00:00.000Z" },
    ...over,
  };
}

describe("parseGoogleTime", () => {
  it("parses a timed event", () => {
    expect(parseGoogleTime({ dateTime: "2026-06-02T15:00:00.000Z" })).toBe(Date.parse("2026-06-02T15:00:00.000Z"));
  });
  it("parses an all-day date as UTC midnight", () => {
    expect(parseGoogleTime({ date: "2026-06-02" })).toBe(Date.parse("2026-06-02T00:00:00Z"));
  });
  it("returns null for missing/garbage", () => {
    expect(parseGoogleTime(undefined)).toBeNull();
    expect(parseGoogleTime({ dateTime: "not-a-date" })).toBeNull();
  });
});

describe("mapGoogleEvent (pure)", () => {
  const noPulse = new Set<string>();

  it("maps a normal event to an upsert block", () => {
    const r = mapGoogleEvent(ev(), noPulse);
    expect(r.kind).toBe("upsert");
    const block = (r as { kind: "upsert"; block: MappedBlock }).block;
    expect(block.googleEventId).toBe("g1");
    expect(block.title).toBe("Outside booking");
    expect(block.startTime).toBe(Date.parse("2026-06-02T15:00:00.000Z"));
    expect(block.allDay).toBe(false);
  });

  it("flags all-day events", () => {
    const r = mapGoogleEvent(ev({ start: { date: "2026-06-02" }, end: { date: "2026-06-03" } }), noPulse);
    expect(r.kind).toBe("upsert");
    expect((r as { block: MappedBlock }).block.allDay).toBe(true);
  });

  it("falls back to 'Busy' when the event has no summary", () => {
    const r = mapGoogleEvent(ev({ summary: undefined }), noPulse);
    expect((r as { block: MappedBlock }).block.title).toBe("Busy");
  });

  it("skips Pulse-origin events tagged via extendedProperties (no loop)", () => {
    const r = mapGoogleEvent(ev({ extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } } }), noPulse);
    expect(r.kind).toBe("skip");
  });

  it("skips events whose id matches a pushed Pulse session", () => {
    const r = mapGoogleEvent(ev({ id: "session-evt" }), new Set(["session-evt"]));
    expect(r.kind).toBe("skip");
  });

  it("treats a cancelled event as a removal", () => {
    const r = mapGoogleEvent(ev({ status: "cancelled" }), noPulse);
    expect(r).toEqual({ kind: "cancel", googleEventId: "g1" });
  });

  it("skips events with no id or unparseable / inverted times", () => {
    expect(mapGoogleEvent(ev({ id: undefined }), noPulse).kind).toBe("skip");
    expect(mapGoogleEvent(ev({ start: { dateTime: "x" } }), noPulse).kind).toBe("skip");
    expect(
      mapGoogleEvent(
        ev({ start: { dateTime: "2026-06-02T17:00:00Z" }, end: { dateTime: "2026-06-02T15:00:00Z" } }),
        noPulse,
      ).kind,
    ).toBe("skip");
  });
});

describe("_applyDelta + blocksInRange (integration)", () => {
  const t = (iso: string) => Date.parse(iso);

  it("upserts, updates, then cancels blocks idempotently and persists the syncToken", async () => {
    const tt = convexTest(schema);
    await tt.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });

    // First pull: two blocks.
    await tt.mutation(internal.googleCalendarSync._applyDelta, {
      orgId: ORG,
      upserts: [
        { googleEventId: "a", title: "A", startTime: t("2026-06-02T10:00:00Z"), endTime: t("2026-06-02T11:00:00Z"), allDay: false },
        { googleEventId: "b", title: "B", startTime: t("2026-06-02T12:00:00Z"), endTime: t("2026-06-02T13:00:00Z"), allDay: false },
      ],
      cancels: [],
      nextSyncToken: "tok-1",
    });

    let blocks = await tt.query(api.googleCalendarSync.blocksInRange, {
      from: t("2026-06-02T00:00:00Z"),
      to: t("2026-06-03T00:00:00Z"),
    });
    expect(blocks.map((b) => b.title).sort()).toEqual(["A", "B"]);

    // Second (incremental) pull: A retitled, B cancelled.
    await tt.mutation(internal.googleCalendarSync._applyDelta, {
      orgId: ORG,
      upserts: [
        { googleEventId: "a", title: "A renamed", startTime: t("2026-06-02T10:00:00Z"), endTime: t("2026-06-02T11:30:00Z"), allDay: false },
      ],
      cancels: ["b"],
      nextSyncToken: "tok-2",
    });

    blocks = await tt.query(api.googleCalendarSync.blocksInRange, {
      from: t("2026-06-02T00:00:00Z"),
      to: t("2026-06-03T00:00:00Z"),
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("A renamed");
    expect(blocks[0].endTime).toBe(t("2026-06-02T11:30:00Z"));

    const st = await tt.query(api.googleCalendarSync.status, {});
    expect(st.blockCount).toBe(1);
    expect(st.syncedAt).not.toBeNull();
    expect(st.error).toBeNull();
  });
});
