import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { PlaidConnectCard } from "./plaid-connect-card";

const state = vi.hoisted(() => ({
  canRead: true,
  reportsEnabled: true,
  canManage: true,
}));

vi.mock("@/lib/use-capabilities", () => ({
  useCapabilities: () => ({ loaded: true, can: () => state.canRead }),
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    if (name === "orgs:current") return { disabledFeatures: state.reportsEnabled ? [] : ["reports"] };
    if (name === "banking:overview") {
      if (args === "skip") return undefined;
      // Match the server's refusal: Settings must remain usable when banking
      // is unavailable because of either the plan or the viewer's access.
      if (!state.reportsEnabled || !state.canRead) throw new Error("Banking access denied");
      return { configured: true, environment: "sandbox", canManage: state.canManage, connections: [] };
    }
    throw new Error(`Unexpected query: ${name}`);
  },
}));

describe("Plaid in Settings integrations", () => {
  beforeEach(() => {
    state.canRead = true;
    state.reportsEnabled = true;
    state.canManage = true;
  });

  it("keeps Settings usable when the plan or workspace disables Reports", () => {
    state.reportsEnabled = false;
    const html = renderToStaticMarkup(createElement(PlaidConnectCard));
    expect(html).toContain("Plaid banking requires Reports");
    expect(html).not.toContain("Connect with Plaid");
  });

  it("does not fetch financial data for a settings user without financial access", () => {
    state.canRead = false;
    const html = renderToStaticMarkup(createElement(PlaidConnectCard));
    expect(html).toContain("Your studio owner can connect a bank");
    expect(html).not.toContain("Manage banking");
  });

  it("lets a financial viewer manage the feed without offering owner-only signup", () => {
    state.canManage = false;
    const html = renderToStaticMarkup(createElement(PlaidConnectCard));
    expect(html).toContain("Manage banking");
    expect(html).not.toContain("Connect with Plaid");
  });

  it("offers the owner direct Plaid signup and labels sandbox connections", () => {
    const html = renderToStaticMarkup(createElement(PlaidConnectCard));
    expect(html).toContain("Connect with Plaid");
    expect(html).toContain("Sandbox");
    expect(html).toContain('href="/banking"');
  });
});
