// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page";
import { PageHeaderSlotProvider } from "@/components/shell/page-header-slot";

/* Inside the hardware shell a page's header moves into the top bar chassis
   (a portal); outside it, the header renders where it always did. */
describe("PageHeader", () => {
  it("renders inline outside the shell", () => {
    const html = renderToStaticMarkup(<PageHeader overline="Money" title="Payments" description="Invoices and cash flow" />);
    expect(html).toContain("Payments");
    expect(html).toContain("Invoices and cash flow");
  });

  it("leaves nothing in the page body inside the shell, so the title never shows twice", () => {
    const html = renderToStaticMarkup(
      <PageHeaderSlotProvider>
        <PageHeader title="Payments" actions={<button>New invoice</button>} />
      </PageHeaderSlotProvider>,
    );
    expect(html).toBe("");
  });
});
