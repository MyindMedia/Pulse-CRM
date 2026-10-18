import { describe, expect, it } from "vitest";
import { QUESTIONS, briefText, focusLines } from "./brief";

describe("booked brief", () => {
  it("maps every pain option to a focus line", () => {
    const pains = QUESTIONS.find((q) => q.id === "pains")!.options.map((o) => o.id);
    expect(focusLines({ rooms: null, today: null, pains: [...pains] })).toHaveLength(pains.length);
  });

  it("writes a short text with the picks and nothing personal", () => {
    const t = briefText({ rooms: "2-3", today: "dms", pains: ["noshows", "chasing"] });
    expect(t).toBe("My Pulse demo focus. Rooms: 2 to 3. Bookings today: Texts and DMs. Biggest cost: No-shows, Chasing payments.");
    expect(t.length).toBeLessThan(160);
  });
});
