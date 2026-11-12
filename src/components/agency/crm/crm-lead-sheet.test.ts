// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso, lostBody, noteBody, noteEvent, reachability, wonBody, withLocalNotes } from "./crm-lead-sheet";
import { MAYA, STAGES } from "./crm-test-fixtures";
import { stableStringify } from "./zu-store";

/* Lead sheet logic. Node environment so the time zone can be switched. */
const TZ = process.env.TZ;
afterEach(() => { process.env.TZ = TZ; });

describe("F-U16 datetime custom fields", () => {
  it("F-U16: ISO converts to local wall time for datetime-local and back, outside UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(isoToLocalInput("2026-11-11T20:30:00Z")).toBe("2026-11-11T12:30");
    expect(localInputToIso("2026-11-11T12:30")).toBe("2026-11-11T20:30:00.000Z");
    process.env.TZ = "Asia/Kolkata";
    expect(isoToLocalInput("2026-11-11T20:30:00Z")).toBe("2026-11-12T02:00");
    expect(localInputToIso(isoToLocalInput("2026-11-11T20:30:00Z"))).toBe("2026-11-11T20:30:00.000Z");
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("not a date")).toBe("");
    expect(localInputToIso("")).toBeNull();
  });
});

describe("F-U2 reaching the lead, as Zuops reports it", () => {
  it("F-U2: four rows from email_opt_out, email_invalid, email_paused and phone_invalid, with reasons; nothing invented", () => {
    const rows = reachability({
      ...MAYA, email_opt_out: true, email_opt_out_reason: "Replied STOP to an email", email_invalid: false, email_paused: false,
      phone_invalid: true, phone_invalid_reason: "Landline",
    });
    expect(rows.map((r) => [r.label, r.word])).toEqual([
      ["Email opt-out", "Opted out of email"],
      ["Email address", "No problem reported"],
      ["Email sending", "Not paused"],
      ["Phone number", "Invalid"],
    ]);
    expect(rows[0].detail).toContain("Replied STOP to an email");
    expect(rows[3].detail).toBe("Landline");
    // A list row has none of these fields: say so instead of claiming "fine".
    expect(reachability(MAYA).every((r) => r.word === "Not reported")).toBe(true);
    expect(rows.some((r) => /text|do not contact/i.test(r.label))).toBe(false);
  });
});

describe("R3-U2 a note shows at once", () => {
  it("R3-U2: the new note goes to the top of the timeline until the re-read carries it", () => {
    const server = [{ id: "e1", event_type: "created", body: null, created_at: "2026-11-01T17:00:00Z" }];
    const local = [noteEvent(undefined, " Called, wants a Friday demo ", "k1", Date.UTC(2026, 10, 11, 12))];
    expect(local[0]).toMatchObject({ id: "local-note-k1", event_type: "note", body: "Called, wants a Friday demo", actor_label: "You", created_at: "2026-11-11T12:00:00.000Z" });
    expect(withLocalNotes(server, local).map((e) => e.id)).toEqual(["local-note-k1", "e1"]);
    // Once the timeline has it (same body on a note event, or the same id) it is shown once.
    expect(withLocalNotes([{ id: "n9", event_type: "note_added", body: "Called, wants a Friday demo" }, ...server], local).map((e) => e.id)).toEqual(["n9", "e1"]);
    const fromServer = noteEvent({ note: { id: "n9", body: "Called, wants a Friday demo", created_at: "2026-11-11T12:00:01Z" } }, "x", "k2");
    expect(fromServer.id).toBe("n9");
    expect(withLocalNotes([{ id: "n9", event_type: "lead_note", body: "edited" }], [fromServer]).map((e) => e.id)).toEqual(["n9"]);
  });
});

describe("R3-U3 retry keys cover the whole body", () => {
  it("R3-U3: Won and Lost bodies change with the stage list, so their fingerprints do too", () => {
    expect(lostBody([])).toEqual({ status: "lost" });
    expect(lostBody(STAGES)).toEqual({ stage_key: "lost" });
    expect(wonBody([], 118800)).toEqual({ status: "won", deal_value_cents: 118800 });
    expect(wonBody(STAGES, null)).toEqual({ stage_key: "won", deal_value_cents: null });
    expect(stableStringify(lostBody([]))).not.toBe(stableStringify(lostBody(STAGES)));
    expect(stableStringify(wonBody([], 100))).not.toBe(stableStringify(wonBody(STAGES, 100)));
    expect(noteBody("  hi ")).toEqual({ body: "hi" });
  });
});
