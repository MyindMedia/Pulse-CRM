import { describe, it, expect } from "vitest";
import { isShellDocument, SHELL_CONNECT_MESSAGE } from "./shell";

/* The shell stamps `pulse-shell` on <html> before any page script runs. Reading
   it is how Pulse tells a real browser popup apart from the shell's shim, which
   hands the URL to a separate application and always returns null. */
const withClasses = (...names: string[]) => ({
  classList: { contains: (t: string) => names.includes(t) },
});

describe("isShellDocument", () => {
  it("is false in a plain browser", () => {
    expect(isShellDocument(withClasses())).toBe(false);
    expect(isShellDocument(withClasses("dark", "font-loaded"))).toBe(false);
  });

  it("is true once the shell has stamped the document", () => {
    expect(isShellDocument(withClasses("pulse-shell"))).toBe(true);
    expect(isShellDocument(withClasses("dark", "pulse-shell"))).toBe(true);
  });

  it("survives having no document at all, as on the server", () => {
    expect(isShellDocument(null)).toBe(false);
    expect(isShellDocument(undefined)).toBe(false);
  });
});

describe("SHELL_CONNECT_MESSAGE", () => {
  it("does not blame a popup blocker or ask for a setting change", () => {
    // The whole point: the owner was told to allow popups, which was never the
    // problem and could not have fixed it.
    expect(SHELL_CONNECT_MESSAGE).not.toMatch(/block|allow popups/i);
  });

  it("says where the connect can actually be done", () => {
    expect(SHELL_CONNECT_MESSAGE).toMatch(/browser/i);
  });
});
