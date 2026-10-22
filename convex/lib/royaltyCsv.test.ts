import { describe, it, expect } from "vitest";
import { detectFormat, headerSignature, microsToCents, parseStatement, periodOf, records, toMicros } from "./royaltyCsv";

/* Fixtures follow each distributor's published export columns (real sample
   files to confirm: design.md Open Questions). */

const DISTROKID = [
  "Reporting Date\tSale Month\tStore\tArtist\tTitle\tISRC\tUPC\tQuantity\tTeam Percentage\tSong/Album\tCountry of Sale\tSongwriter Royalties Withheld\tEarnings (USD)",
  "2026-09-05\t2026-07\tSpotify\tLB\tNight Drive\tUSABC2600001\t123\t1000\t100\tSong\tUS\t0\t3.4012",
  "2026-09-05\t2026-07\tApple Music\tLB\tNight Drive\tUSABC2600001\t123\t200\t100\tSong\tGB\t0\t1.5991",
  "2026-09-05\t2026-08\tSpotify\tLB\tDaybreak\tUSABC2600002\t123\t10\t100\tSong\tUS\t0\t0.0049",
  "2026-09-05\t2026-08\tSpotify\tLB\tDaybreak\tUSABC2600002\t123\t10\t100\tSong\tDE\t0\t0.0049",
].join("\n");

const TUNECORE = [
  "Posted Date,Sales Period,Store Name,Country Of Sale,Artist,Release Type,Release Title,Song Title,Label,UPC,Optional UPC,TC Song ID,Optional ISRC,# Units Sold,Per Unit Price,Net Sales,Net Sales Currency,Exchange Rate,Total Earned,Currency",
  '2026-10-01,2026-08,Spotify,US,"Doe, Jane",Single,Glass,Glass,Indie,1,,99,USXYZ2600010,500,0.004,2.00,USD,1,2.00,USD',
  '2026-10-01,2026-08,Deezer,FR,"Doe, Jane",Single,Glass,Glass,Indie,1,,99,USXYZ2600010,100,0.003,0.30,EUR,1.1,0.27,EUR',
].join("\r\n");

const CDBABY = [
  "Report Date,Sales Date,Partner,Artist Name,Album Name,Track Name,UPC,ISRC,Country,Quantity,Payable Amount,Currency",
  "2026-10-15,2026-09-01,Spotify,The Band,LP,Opener,1,QZABC2600100,US,42,0.1234,USD",
].join("\n");

describe("records", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines, BOM, blank lines", () => {
    const rows = [...records('﻿a,b\n"x, y","say ""hi""\nthere"\n\n1,2\n', ",")];
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere'], ["1", "2"]]);
  });
});

describe("amounts", () => {
  it("parses distributor money strings to millionths", () => {
    expect(toMicros("3.4012")).toBe(3_401_200);
    expect(toMicros("$1,234.5")).toBe(1_234_500_000);
    expect(toMicros("(1.20)")).toBe(-1_200_000);
    expect(toMicros("-0.000049")).toBe(-49);
    expect(toMicros("1.234,56")).toBe(1_234_560_000);
    expect(toMicros("0,0034")).toBe(3_400);
    expect(toMicros("1.2e-3")).toBe(1_200);
    expect(toMicros("")).toBeNull();
    expect(toMicros("n/a")).toBeNull();
  });

  it("rounds to cents half away from zero", () => {
    expect(microsToCents(5_000)).toBe(1);
    expect(microsToCents(4_999)).toBe(0);
    expect(microsToCents(-5_000)).toBe(-1);
  });

  it("reads sale months in the usual shapes", () => {
    expect(periodOf("2026-07")?.[0]).toBe(Date.UTC(2026, 6, 1));
    expect(periodOf("07/2026")?.[0]).toBe(Date.UTC(2026, 6, 1));
    expect(periodOf("09/15/2026")?.[0]).toBe(Date.UTC(2026, 8, 1));
    expect(periodOf("Jul 2026")?.[0]).toBe(Date.UTC(2026, 6, 1));
    expect(periodOf("202607")?.[0]).toBe(Date.UTC(2026, 6, 1));
    expect(periodOf("soon")).toBeNull();
  });
});

describe("parseStatement", () => {
  it("recognises DistroKid without a mapping and folds rows per ISRC, keeping fractional cents", () => {
    const r = parseStatement(DISTROKID);
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.source).toBe("distrokid");
    expect(r.statement.rowCount).toBe(4);
    expect(r.statement.lines).toEqual([
      { isrc: "USABC2600001", title: "Night Drive", artist: "LB", currency: "USD", amountCents: 500, units: 1200, rows: 2 },
      // 0.0049 + 0.0049 = 0.0098 -> 1 cent; rounding per row would give 0.
      { isrc: "USABC2600002", title: "Daybreak", artist: "LB", currency: "USD", amountCents: 1, units: 20, rows: 2 },
    ]);
    expect(r.statement.totals).toEqual([{ currency: "USD", cents: 501 }]);
    expect(r.statement.periodStart).toBe(Date.UTC(2026, 6, 1));
    expect(r.statement.periodEnd).toBe(Date.UTC(2026, 8, 1) - 1);
  });

  it("recognises TuneCore and keeps each currency on its own line", () => {
    const r = parseStatement(TUNECORE);
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.source).toBe("tunecore");
    expect(r.statement.lines.map((l) => [l.isrc, l.currency, l.amountCents, l.artist])).toEqual([
      ["USXYZ2600010", "USD", 200, "Doe, Jane"],
      ["USXYZ2600010", "EUR", 27, "Doe, Jane"],
    ]);
    expect(r.statement.totals).toEqual([{ currency: "USD", cents: 200 }, { currency: "EUR", cents: 27 }]);
  });

  it("recognises CD Baby", () => {
    const r = parseStatement(CDBABY);
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.source).toBe("cdbaby");
    expect(r.statement.lines[0]).toMatchObject({ isrc: "QZABC2600100", title: "Opener", amountCents: 12 });
  });

  it("asks for a mapping on an unknown layout, then uses it", () => {
    const csv = "Track,Code,Net\nSong A,US-AB1-26-00001,10.00\nSong B,,2.50\n";
    const first = parseStatement(csv);
    expect(first.kind).toBe("needsMapping");
    if (first.kind !== "needsMapping") return;
    expect(first.headers).toEqual(["Track", "Code", "Net"]);
    expect(first.sample).toHaveLength(2);

    const r = parseStatement(csv, { mapping: { title: "Track", isrc: "Code", amount: "Net" } });
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.source).toBe("mapped");
    expect(r.statement.lines.map((l) => [l.isrc ?? null, l.title, l.amountCents])).toEqual([
      ["USAB12600001", "Song A", 1000],
      [null, "Song B", 250],
    ]);
  });

  it("refuses a mapping that names a missing column, and an empty file", () => {
    expect(parseStatement("A,B\n1,2", { mapping: { amount: "Nope", title: "A" } }).kind).toBe("invalid");
    expect(parseStatement("").kind).toBe("invalid");
  });

  it("skips rows with no amount or nothing to match on", () => {
    const r = parseStatement(DISTROKID + "\n2026-09-05\t2026-08\tSpotify\tLB\t\t\t123\t1\t100\tSong\tUS\t0\t1.00");
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.statement.skippedRows).toBe(1);
  });

  it("signs a header layout stably", () => {
    expect(headerSignature([" Track ", "NET"])).toBe("track|net");
    expect(detectFormat(["Track", "Net"])).toBeNull();
  });
});
