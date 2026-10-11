// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftCheckBadge } from "./draft-check-badge";

/* The approval inbox badge for Jev's read on an agent draft. Without a read
   (no key, Jev down, not an email) the card must look exactly as before. */

describe("DraftCheckBadge", () => {
  it("renders nothing when Jev did not check the draft", () => {
    expect(renderToStaticMarkup(<DraftCheckBadge check={undefined} />)).toBe("");
  });

  it("shows the label, with Jev's numbers in the tooltip", () => {
    const html = renderToStaticMarkup(
      <DraftCheckBadge check={{ safeToSend: 0.92, mentionsMoney: 0.04, hasPlaceholder: 0.03, model: "jev-1.13.0", checkedAt: 1 }} />,
    );
    expect(html).toContain("Looks ready");
    expect(html).toContain('data-tone="positive"');
    expect(html).toContain("ready to send 92%, mentions money 4%, placeholders 3%");
  });

  it("flags placeholders in the critical tone", () => {
    const html = renderToStaticMarkup(
      <DraftCheckBadge check={{ safeToSend: 0.2, mentionsMoney: 0.1, hasPlaceholder: 0.9, model: "jev-1.13.0", checkedAt: 1 }} />,
    );
    expect(html).toContain("Has placeholders");
    expect(html).toContain('data-tone="critical"');
  });
});
