import { describe, expect, it } from "vitest";
import {
  EMPTY_COMMENT_FILTERS, commentsQuery, connectionStatus, dmStatus, isNotEnabled, mergeDms, moveCountText, platformWord,
  type SocialMessage,
} from "./social-logic";

describe("social logic", () => {
  it("knows when Instagram and Messenger is off", () => {
    expect(isNotEnabled({ reason: "x", code: "not_enabled", status: 403 } as never)).toBe(true);
    expect(isNotEnabled({ reason: "Instagram & Messenger is not enabled", status: 403 } as never)).toBe(true);
    expect(isNotEnabled({ reason: "Rate limited", code: "rate_limited", status: 429 } as never)).toBe(false);
    expect(isNotEnabled(null)).toBe(false);
  });

  it("platform and status words", () => {
    expect(platformWord("instagram")).toBe("Instagram");
    expect(platformWord("facebook")).toBe("Messenger");
    expect(connectionStatus({ status: "connected", live: true }).word).toBe("Connected");
    expect(connectionStatus({ status: "connected", live: false }).ok).toBe(false);
    expect(connectionStatus({ status: "needs_reconnect" }).word).toBe("Needs reconnect");
    expect(dmStatus("skipped").word).toBe("DM skipped (already sent)");
  });

  it("comments query only sends set filters; the end date covers its day", () => {
    expect(commentsQuery(EMPTY_COMMENT_FILTERS, 0)).toEqual({
      limit: 25, offset: undefined, status: undefined, account_id: undefined, search: undefined, from: undefined, to: undefined, oldest_first: undefined,
    });
    const q = commentsQuery({ status: "failed", account: "a1", search: "  price ", from: "2026-11-01", to: "2026-11-10", oldestFirst: true }, 50);
    expect(q).toMatchObject({ offset: 50, status: "failed", account_id: "a1", search: "price", from: "2026-11-01", to: "2026-11-10T23:59:59Z", oldest_first: true });
  });

  it("move count text", () => {
    expect(moveCountText(0)).toMatch(/^Nobody needs to move/);
    expect(moveCountText(1)).toBe("1 person would move back to Messages");
    expect(moveCountText(1200)).toBe("1,200 people would move back to Messages");
  });

  it("DMs merge newest first", () => {
    const a = [{ id: "a", created_at: "2026-11-10T10:00:00Z" }] as SocialMessage[];
    const b = [{ id: "b", created_at: "2026-11-11T10:00:00Z" }] as SocialMessage[];
    expect(mergeDms(a, b).map((m) => m.id)).toEqual(["b", "a"]);
  });
});
