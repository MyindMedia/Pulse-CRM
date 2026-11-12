import { describe, expect, it, vi } from "vitest";
import { focusOnClose, rowOpener } from "./resource-focus";

/* No DOM in this suite (edge-runtime), so elements are stand-ins with the
   few members these helpers touch. */

const el = (connected = true, rowOpen?: string) =>
  ({ isConnected: connected, focus: vi.fn(), dataset: rowOpen ? { rowOpen } : {} }) as unknown as HTMLElement & { focus: ReturnType<typeof vi.fn> };
const ev = () => ({ preventDefault: vi.fn() }) as unknown as Event & { preventDefault: ReturnType<typeof vi.fn> };
const ref = <T,>(current: T) => ({ current });

describe("R3-R7: focus returns to the opener", () => {
  it("goes to the opener when it is still there", () => {
    const opener = el();
    const home = el();
    const e = ev();
    focusOnClose(e, ref(opener), ref(home));
    expect(opener.focus).toHaveBeenCalled();
    expect(home.focus).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("falls back to the panel heading (or sheet title) when a write replaced the opener", () => {
    const gone = el(false);
    const home = el();
    focusOnClose(ev(), ref(gone), ref(home));
    expect(gone.focus).not.toHaveBeenCalled();
    expect(home.focus).toHaveBeenCalled();
    const e = ev();
    focusOnClose(e, () => null, null);
    expect(e.preventDefault).not.toHaveBeenCalled(); // nothing better: leave the dialog's own restore alone
  });

  it("finds a row's open button again by id after a re-read", () => {
    const a = el(true, "a1");
    const b = el(true, "b2");
    const scope = { querySelectorAll: () => [a, b] } as unknown as HTMLElement;
    expect(rowOpener(scope, "b2")).toBe(b);
    expect(rowOpener(scope, "zz")).toBeNull();
    expect(rowOpener(null, "a1")).toBeNull();
    const home = el();
    focusOnClose(ev(), () => rowOpener(scope, "a1"), ref(home));
    expect(a.focus).toHaveBeenCalled();
  });
});
