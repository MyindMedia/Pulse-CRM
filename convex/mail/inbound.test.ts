import { describe, it, expect } from "vitest";
import { attachmentStorage } from "./inbound";

describe("attachmentStorage (inbound attachment bytes)", () => {
  it("never serves sender-chosen types: always octet-stream, always a download", () => {
    for (const name of ["invoice.html", "logo.svg", "statement.pdf", "page.xhtml"]) {
      const s = attachmentStorage(name);
      expect(s.mimeType).toBe("application/octet-stream");
      expect(s.disposition.startsWith("attachment;")).toBe(true);
    }
  });
  it("keeps a safe filename and cannot be used to inject header parameters", () => {
    const s = attachmentStorage('evil";\r\nX-Bad: 1; filename*=x.html');
    expect(s.disposition).not.toMatch(/[\r\n]/);
    expect(s.disposition.match(/"/g)?.length).toBe(2);
    expect(s.disposition).toMatch(/^attachment; filename="[^"]*"$/);
    expect(attachmentStorage("").disposition).toBe('attachment; filename="attachment"');
  });
});
