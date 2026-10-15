import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* Drive the hook through a server render with next/navigation mocked: capture
   the opener, call it, and check the URL it hands the router. */
const h = vi.hoisted(() => ({
  pathname: "/roster/a1",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  usePathname: () => h.pathname,
}));

import { useOpenSession } from "./use-open-session";

function capture(): (id: string | null) => void {
  let opener: ((id: string | null) => void) | null = null;
  function Probe() {
    opener = useOpenSession();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return opener!;
}

describe("useOpenSession", () => {
  const original = globalThis.window;
  beforeEach(() => {
    h.replace.mockReset();
    h.pathname = "/roster/a1";
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("opens a booking in place, keeping other params, without scrolling", () => {
    (globalThis as { window?: unknown }).window = { location: { search: "?tab=sessions" } };
    capture()("s1");
    expect(h.replace).toHaveBeenCalledWith("/roster/a1?tab=sessions&session=s1", { scroll: false });
  });

  it("closes by dropping only the session param", () => {
    h.pathname = "/today";
    (globalThis as { window?: unknown }).window = { location: { search: "?session=s1&x=1" } };
    capture()(null);
    expect(h.replace).toHaveBeenCalledWith("/today?x=1", { scroll: false });
  });

  it("works with no window (server) and no params", () => {
    (globalThis as { window?: unknown }).window = undefined;
    h.pathname = "/dashboard";
    capture()("s9");
    expect(h.replace).toHaveBeenCalledWith("/dashboard?session=s9", { scroll: false });
  });
});
