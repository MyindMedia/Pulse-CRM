import { describe, it, expect } from "vitest";
import { isTouchApple } from "./platform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD_OLD =
  "Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1";
// iPadOS 13+ asks for the desktop site: the same string as Safari on a Mac.
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

describe("isTouchApple", () => {
  it("catches iPhone and iPad, including iPadOS reporting as a Mac", () => {
    expect(isTouchApple({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isTouchApple({ userAgent: IPAD_OLD, maxTouchPoints: 5 })).toBe(true);
    expect(isTouchApple({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toBe(true);
  });

  it("catches other iOS browsers (all of them are WebKit underneath)", () => {
    expect(isTouchApple({ userAgent: IOS_CHROME, maxTouchPoints: 5 })).toBe(true);
  });

  it("leaves a real Mac, Android and Windows alone", () => {
    expect(isTouchApple({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
    expect(isTouchApple({ userAgent: MAC_SAFARI })).toBe(false);
    expect(isTouchApple({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
    expect(isTouchApple({ userAgent: WINDOWS, maxTouchPoints: 10 })).toBe(false);
    expect(isTouchApple({})).toBe(false);
  });
});
