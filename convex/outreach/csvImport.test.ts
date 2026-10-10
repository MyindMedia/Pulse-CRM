import { describe, it, expect } from "vitest";
import { parseCsv, readImportRows, rowProblem, MAX_IMPORT_ROWS } from "./csvImport";

describe("outreach CSV parsing", () => {
  it("handles quotes, escaped quotes, commas and line breaks inside fields, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\nlast,,\n');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'he said "hi"', "line1\nline2"], ["last", "", ""]]);
  });

  it("maps the outreach columns, ignores extras and email_generic, and reads numbers", () => {
    const [r] = readImportRows("Website,Personalization Hook,email_generic,fit_score,followup_day14,whatever\nmix.com, A hook ,info@mix.com,7,Bye,zzz");
    expect(r).toEqual({ line: 2, website: "mix.com", hook: "A hook", hookSourceUrl: undefined, subject: undefined, body: undefined, igDm: undefined,
      followups: { step1: undefined, step2: undefined, step3: "Bye" }, fitScore: 7, priority: undefined });
    expect(JSON.stringify(r)).not.toContain("info@mix.com");
  });

  it("caps the file at 200 data rows and needs a website column", () => {
    const body = (n: number) => "website\n" + Array.from({ length: n }, (_, i) => `s${i}.com`).join("\n");
    expect(readImportRows(body(MAX_IMPORT_ROWS))).toHaveLength(200);
    expect(() => readImportRows(body(MAX_IMPORT_ROWS + 1))).toThrow(/at most 200/);
    expect(() => readImportRows("hook\nx")).toThrow(/website column/);
    expect(() => readImportRows("")).toThrow(/empty/);
  });

  it("flags rows it cannot store as is", () => {
    const [ok, noSite, long] = readImportRows(`website,email_subject\nmix.com,Hi\n,Hi\nmix2.com,${"x".repeat(151)}`);
    expect(rowProblem(ok)).toBeNull();
    expect(rowProblem(noSite)).toBe("no website");
    expect(rowProblem(long)).toBe("email_subject is too long");
  });
});
