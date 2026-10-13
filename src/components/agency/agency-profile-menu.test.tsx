import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* Server-render the agency console's account menu with and without Clerk. Demo
   mode boots with no <ClerkProvider>, where the Clerk hooks throw, so the menu
   must not call them. The dropdown renders its content inline here so the
   markup shows the menu items. */
const h = vi.hoisted(() => ({
  clerkMounted: false,
  user: null as null | { fullName: string; primaryEmailAddress: { emailAddress: string } | null; imageUrl: string },
  profile: undefined as unknown,
  signOut: () => Promise.resolve(),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => {
    if (!h.clerkMounted) throw new Error("useUser can only be used within the <ClerkProvider /> component.");
    return { user: h.user };
  },
  useClerk: () => {
    if (!h.clerkMounted) throw new Error("useClerk can only be used within the <ClerkProvider /> component.");
    return { signOut: h.signOut };
  },
}));

vi.mock("convex/react", () => ({
  useQuery: () => h.profile,
  useMutation: () => async () => null,
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const { createElement } = await import("react");
  const block = (tag: string) => ({ children }: { children?: ReactNode }) => createElement(tag, null, children);
  return {
    DropdownMenu: block("div"),
    DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => children,
    DropdownMenuContent: block("div"),
    DropdownMenuItem: block("div"),
    DropdownMenuSeparator: () => createElement("hr"),
  };
});

// The Clerk-or-demo switch is read when the module loads, so each case re-imports it.
async function loadMenu(publishableKey: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", publishableKey);
  const mod = await import("./agency-profile-menu");
  return mod.AgencyProfileMenu;
}

beforeEach(() => {
  h.clerkMounted = false;
  h.user = null;
  h.profile = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AgencyProfileMenu", () => {
  it("renders in demo mode with no Clerk provider and offers no sign-out", async () => {
    const AgencyProfileMenu = await loadMenu("");
    const markup = renderToStaticMarkup(createElement(AgencyProfileMenu));
    expect(markup).toContain('aria-label="Account menu"');
    expect(markup).toContain(">Agency<");
    expect(markup).toContain("Edit profile");
    expect(markup).not.toContain("Sign out");
  });

  it("shows the Clerk account and sign-out when Clerk is configured", async () => {
    h.clerkMounted = true;
    h.user = { fullName: "Ada Lovelace", primaryEmailAddress: { emailAddress: "ada@example.com" }, imageUrl: "" };
    const AgencyProfileMenu = await loadMenu("pk_test_example");
    const markup = renderToStaticMarkup(createElement(AgencyProfileMenu));
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("ada@example.com");
    expect(markup).toContain("Sign out");
  });
});
