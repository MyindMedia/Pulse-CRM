// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso, reachability } from "./crm-lead-sheet";
import { MAYA } from "./crm-test-fixtures";

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
