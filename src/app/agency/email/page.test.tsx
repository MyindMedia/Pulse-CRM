// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/* /agency/email moved into the CRM's Email tab. Server-rendered: the fallback
   link is checked as markup; the effect that replaces the URL does not run on the
   server, so its target is checked in the source. Not a browser check. */
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }) }));

import EmailMovedPage from "./page";

describe("/agency/email", () => {
  it("renders the no-JavaScript fallback link to CRM > Email and none of the old inbox", () => {
    const out = renderToStaticMarkup(<EmailMovedPage />);
    expect(out).toContain('href="/agency/crm#email"');
    expect(out).toContain("Email moved into the CRM. Open Email.");
    expect(out).not.toContain("<h1");
    expect(out).not.toContain("Checking email access");
  });

  it("replaces the URL with /agency/crm#email from an effect, on the client", () => {
    const src = readFileSync(path.resolve(__dirname, "page.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).toMatch(/const EMAIL_HREF = "\/agency\/crm#email";/);
    expect(src).toMatch(/useEffect\(\(\) => \{\s*router\.replace\(EMAIL_HREF\);/);
    expect(src).not.toContain("EmailInbox");
  });
});
