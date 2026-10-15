import { describe, it, expect } from "vitest";
import { entityHref, sessionHref, withSessionParam } from "./entity-href";

describe("entityHref", () => {
  it("maps every entity with a detail page to its route", () => {
    expect(entityHref("artist", "a1")).toBe("/roster/a1");
    expect(entityHref("client", "a1")).toBe("/roster/a1");
    expect(entityHref("song", "s1")).toBe("/songs/s1");
    expect(entityHref("invoice", "i1")).toBe("/payments/i1");
    expect(entityHref("payment", "i1")).toBe("/payments/i1");
    expect(entityHref("project", "p1")).toBe("/projects/p1");
    expect(entityHref("room", "r1")).toBe("/studio/r1");
  });

  it("opens a deal on the pipeline board and a member on Settings > Team", () => {
    expect(entityHref("opportunity", "o1")).toBe("/pipeline?deal=o1");
    expect(entityHref("deal", "o1")).toBe("/pipeline?deal=o1");
    expect(entityHref("member", "m1")).toBe("/settings?tab=team");
  });

  it("opens a session on the calendar by default and in place when given a location", () => {
    expect(entityHref("session", "x1")).toBe("/calendar?session=x1");
    expect(entityHref("booking", "x1")).toBe("/calendar?session=x1");
    expect(entityHref("session", "x1", { pathname: "/roster/a1", search: "?tab=sessions" })).toBe(
      "/roster/a1?tab=sessions&session=x1",
    );
  });

  it("returns null for unknown types and missing ids", () => {
    expect(entityHref(undefined, "x")).toBeNull();
    expect(entityHref("session", undefined)).toBeNull();
    expect(entityHref("session", null)).toBeNull();
    expect(entityHref("widget", "x")).toBeNull();
  });

  it("encodes ids so a path never breaks", () => {
    expect(entityHref("song", "a/b")).toBe("/songs/a%2Fb");
  });
});

describe("withSessionParam", () => {
  it("sets the param and keeps the others", () => {
    expect(withSessionParam("?view=week&room=r1", "s1")).toBe("?view=week&room=r1&session=s1");
    expect(withSessionParam("view=week", "s1")).toBe("?view=week&session=s1");
    expect(withSessionParam("", "s1")).toBe("?session=s1");
  });

  it("replaces an open session rather than stacking", () => {
    expect(withSessionParam("?session=old&tab=x", "new")).toBe("?session=new&tab=x");
  });

  it("clears the param and leaves no stray ?", () => {
    expect(withSessionParam("?session=s1", null)).toBe("");
    expect(withSessionParam("?tab=x&session=s1", null)).toBe("?tab=x");
  });

  it("sessionHref falls back to the calendar", () => {
    expect(sessionHref("s1")).toBe("/calendar?session=s1");
    expect(sessionHref("s1", { pathname: "/today" })).toBe("/today?session=s1");
  });
});
