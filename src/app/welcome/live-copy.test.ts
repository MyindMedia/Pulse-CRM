import { describe, it, expect } from "vitest";
import { liveScreenCopy } from "./live-copy";

describe("welcome finish screen copy", () => {
  it("does not say 'taking bookings' when there is no room", () => {
    const c = liveScreenCopy({ studioName: "Skyline", bookableRooms: 0, depositsReady: false });
    expect(c.headline).not.toMatch(/taking bookings/);
    expect(c.body).toMatch(/Add a room/);
    expect(c.todo).toMatch(/Connect Stripe/);
  });

  it("does not promise a deposit without Stripe", () => {
    const c = liveScreenCopy({ studioName: "Skyline", bookableRooms: 1, depositsReady: false });
    expect(c.headline).toBe("Skyline is taking bookings");
    expect(c.body).not.toMatch(/lock it in with a deposit/);
    expect(c.body).toMatch(/Connect Stripe/);
  });

  it("says live with deposits only when both are true", () => {
    const c = liveScreenCopy({ studioName: "Skyline", bookableRooms: 2, depositsReady: true });
    expect(c.eyebrow).toBe("You are live");
    expect(c.body).toMatch(/lock it in with a deposit/);
  });
});
