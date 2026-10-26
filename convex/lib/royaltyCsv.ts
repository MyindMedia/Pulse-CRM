/* ============================================================
   Royalty Statement parsing (pure, no ctx). A distributor export is
   one row per store x country x month x track, often 100k rows. We
   never keep the rows: each record is folded straight into one line
   per recording (ISRC, else title + artist) per currency, summing in
   millionths of a unit so fractional-cent streaming rows lose nothing,
   and rounding to cents once per line.

   Formats are recognised from the header row. The column lists below
   follow each distributor's published export; an unknown header falls
   back to a column mapping the studio picks once (royaltyMappings).
   ============================================================ */

export type StatementSource = "distrokid" | "tunecore" | "cdbaby" | "mapped";

export type ColumnMap = {
  isrc?: string;
  title?: string;
  artist?: string;
  amount: string;
  currency?: string;
  units?: string;
  period?: string;
};

export type ParsedLine = {
  isrc?: string;
  title?: string;
  artist?: string;
  currency: string;
  amountCents: number;
  units: number;
  rows: number;
};

export type ParsedStatement = {
  lines: ParsedLine[];
  totals: { currency: string; cents: number }[];
  periodStart?: number;
  periodEnd?: number;
  rowCount: number;
  /** Rows with no amount or no way to tell the recording apart. */
  skippedRows: number;
};

/* ── Delimited text ─────────────────────────────────────────── */

/** Tab when the header has more tabs than commas (DistroKid exports TSV). */
export function detectDelimiter(firstLine: string): "," | "\t" | ";" {
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const tabs = count("\t");
  const commas = count(",");
  const semis = count(";");
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/** RFC 4180 records, one at a time; quotes may wrap delimiters and newlines. */
export function* records(text: string, delimiter: string): Generator<string[]> {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const row: string[] = [];
    let field = "";
    let quoted = false;
    for (;;) {
      if (i >= n) {
        row.push(field);
        break;
      }
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === '"' && field === "") {
        quoted = true;
        i++;
        continue;
      }
      if (ch === delimiter) {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        row.push(field);
        i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
        break;
      }
      field += ch;
      i++;
    }
    if (row.length === 1 && row[0].trim() === "") continue; // blank line
    yield row;
  }
}

/* ── Headers and formats ────────────────────────────────────── */

export const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Stable key for "this exact export layout", for a remembered mapping. */
export function headerSignature(headers: string[]): string {
  return headers.map(normHeader).join("|").slice(0, 900);
}

type FormatSpec = {
  source: Exclude<StatementSource, "mapped">;
  /** Every one of these headers present = this format. */
  requires: string[];
  /** Candidates per field, first present wins. */
  columns: { [K in keyof ColumnMap]: string[] };
  /** When the file carries no currency column. */
  currency?: string;
};

const FORMATS: FormatSpec[] = [
  {
    // DistroKid: Bank > "See excruciating detail" > Download (TSV).
    source: "distrokid",
    requires: ["reporting date", "sale month", "store", "isrc", "earnings (usd)"],
    columns: {
      isrc: ["isrc"],
      title: ["title"],
      artist: ["artist"],
      amount: ["earnings (usd)"],
      units: ["quantity"],
      period: ["sale month"],
    },
    currency: "USD",
  },
  {
    // TuneCore: Money > Sales Report > Export.
    source: "tunecore",
    requires: ["sales period", "store name", "song title", "total earned"],
    columns: {
      isrc: ["isrc", "optional isrc"],
      title: ["song title"],
      artist: ["artist"],
      amount: ["total earned"],
      currency: ["currency", "net sales currency"],
      units: ["# units sold", "units sold", "quantity"],
      period: ["sales period"],
    },
  },
  {
    // CD Baby: Accounting > Digital Distribution > Download report.
    source: "cdbaby",
    requires: ["partner", "isrc", "track name"],
    columns: {
      isrc: ["isrc"],
      title: ["track name"],
      artist: ["artist name", "artist"],
      amount: ["payable amount", "artist payout", "net payable", "subtotal"],
      currency: ["currency", "payable currency"],
      units: ["quantity", "units"],
      period: ["sales date", "sale date", "report date"],
    },
    currency: "USD",
  },
];

/** Resolve a format's candidate headers against this file's headers. */
function resolve(spec: FormatSpec, headers: string[]): ColumnMap | null {
  const have = new Map(headers.map((h) => [normHeader(h), h]));
  const pick = (cands?: string[]) => cands?.map((c) => have.get(c)).find(Boolean);
  const amount = pick(spec.columns.amount);
  if (!amount) return null;
  return {
    amount,
    isrc: pick(spec.columns.isrc),
    title: pick(spec.columns.title),
    artist: pick(spec.columns.artist),
    currency: pick(spec.columns.currency),
    units: pick(spec.columns.units),
    period: pick(spec.columns.period),
  };
}

export function detectFormat(
  headers: string[],
): { source: Exclude<StatementSource, "mapped">; columns: ColumnMap; currency?: string } | null {
  const set = new Set(headers.map(normHeader));
  for (const spec of FORMATS) {
    if (!spec.requires.every((r) => set.has(r))) continue;
    const columns = resolve(spec, headers);
    if (columns) return { source: spec.source, columns, currency: spec.currency };
  }
  return null;
}

/** A saved or submitted mapping must name real headers and an amount. */
export function validMapping(headers: string[], m: ColumnMap): boolean {
  const set = new Set(headers);
  if (!set.has(m.amount)) return false;
  if (!m.isrc && !m.title) return false;
  return (["isrc", "title", "artist", "currency", "units", "period"] as const).every((k) => !m[k] || set.has(m[k]!));
}

/* ── Values ─────────────────────────────────────────────────── */

/** "1,234.5678", "$0.0034", "(1.20)", "-0.01", "1.234,56" -> millionths, or null. */
export function toMicros(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,\-eE+]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  // Decimal comma ("1.234,56" or "0,0034") when the last separator is a comma
  // followed by other than exactly three digits.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot && !/^\d{3}$/.test(s.slice(lastComma + 1))) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  if (!/^\d*\.?\d*(e[+-]?\d+)?$/i.test(s) || !/\d/.test(s)) return null;
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    const m = Math.round(n * 1_000_000);
    return negative ? -m : m;
  }
  const [whole, frac = ""] = s.split(".");
  const six = (frac + "000000").slice(0, 6);
  const seventh = Number(frac[6] ?? "0");
  let m = Number(whole || "0") * 1_000_000 + Number(six);
  if (seventh >= 5) m += 1;
  return negative ? -m : m;
}

/** Millionths -> cents, half away from zero. */
export function microsToCents(micros: number): number {
  const c = Math.round(Math.abs(micros) / 10_000);
  return micros < 0 ? -c : c;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A row's sale month as [first ms of month, first ms of next month], or null. */
export function periodOf(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  let y: number | undefined;
  let m: number | undefined;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/))) [y, m] = [Number(r[1]), Number(r[2])];
  else if ((r = s.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})/))) [y, m] = [Number(r[2]), Number(r[1])];
  else if ((r = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{4})/))) [y, m] = [Number(r[2]), MONTHS.indexOf(r[1]) + 1];
  else if ((r = s.match(/^(\d{4})(\d{2})$/))) [y, m] = [Number(r[1]), Number(r[2])];
  if (!y || !m || m < 1 || m > 12 || y < 1990 || y > 2100) return null;
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

export function cleanIsrcCell(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s) ? s : undefined;
}

const titleNorm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ── Fold ───────────────────────────────────────────────────── */

/**
 * Read the header, find the format (or use `mapping`), and fold every row
 * into lines. Returns `needsMapping` with the headers when nothing fits.
 */
export function parseStatement(
  text: string,
  opts: { mapping?: ColumnMap; defaultCurrency?: string } = {},
):
  | { kind: "ok"; source: StatementSource; columns: ColumnMap; headers: string[]; statement: ParsedStatement }
  | { kind: "needsMapping"; headers: string[]; sample: string[][] }
  | { kind: "invalid"; reason: string } {
  const firstBreak = text.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const delimiter = detectDelimiter(firstLine);
  const it = records(text, delimiter);
  const head = it.next();
  if (head.done) return { kind: "invalid", reason: "The file is empty." };
  const headers = head.value.map((h) => h.trim());
  if (headers.length < 2) return { kind: "invalid", reason: "That doesn't look like a CSV statement." };

  let source: StatementSource;
  let columns: ColumnMap;
  let fixedCurrency: string | undefined;
  const detected = detectFormat(headers);
  if (opts.mapping) {
    if (!validMapping(headers, opts.mapping)) return { kind: "invalid", reason: "The column mapping doesn't fit this file." };
    source = detected?.source ?? "mapped";
    columns = opts.mapping;
  } else if (detected) {
    source = detected.source;
    columns = detected.columns;
    fixedCurrency = detected.currency;
  } else {
    const sample: string[][] = [];
    for (const row of it) {
      sample.push(row.slice(0, 40).map((c) => c.slice(0, 80)));
      if (sample.length >= 5) break;
    }
    return { kind: "needsMapping", headers, sample };
  }

  const at = (name?: string) => (name ? headers.indexOf(name) : -1);
  const idx = {
    isrc: at(columns.isrc),
    title: at(columns.title),
    artist: at(columns.artist),
    amount: at(columns.amount),
    currency: at(columns.currency),
    units: at(columns.units),
    period: at(columns.period),
  };
  const fallbackCurrency = (opts.defaultCurrency ?? fixedCurrency ?? "USD").toUpperCase();

  type Acc = { line: Omit<ParsedLine, "amountCents"> & { micros: number } };
  const byKey = new Map<string, Acc>();
  let rowCount = 0;
  let skippedRows = 0;
  let start: number | undefined;
  let end: number | undefined;

  for (const row of it) {
    rowCount++;
    const cell = (i: number) => (i >= 0 ? row[i] : undefined);
    const micros = toMicros(cell(idx.amount));
    const isrc = cleanIsrcCell(cell(idx.isrc));
    const title = cell(idx.title)?.trim().slice(0, 200) || undefined;
    const artist = cell(idx.artist)?.trim().slice(0, 200) || undefined;
    if (micros === null || (!isrc && !title)) {
      skippedRows++;
      continue;
    }
    const currencyCell = cell(idx.currency)?.trim().toUpperCase();
    const currency = currencyCell && /^[A-Z]{3}$/.test(currencyCell) ? currencyCell : fallbackCurrency;
    const units = Number((cell(idx.units) ?? "").replace(/[^\d.-]/g, "")) || 0;
    const p = periodOf(cell(idx.period));
    if (p) {
      start = start === undefined ? p[0] : Math.min(start, p[0]);
      end = end === undefined ? p[1] : Math.max(end, p[1]);
    }
    const key = `${isrc ?? `t:${titleNorm(title!)}|${titleNorm(artist ?? "")}`}|${currency}`;
    const acc = byKey.get(key);
    if (acc) {
      acc.line.micros += micros;
      acc.line.units += units;
      acc.line.rows += 1;
      acc.line.title ??= title;
      acc.line.artist ??= artist;
    } else {
      byKey.set(key, { line: { isrc, title, artist, currency, micros, units, rows: 1 } });
    }
  }

  const lines: ParsedLine[] = [];
  const totals = new Map<string, number>();
  for (const { line } of byKey.values()) {
    const { micros, ...rest } = line;
    const amountCents = microsToCents(micros);
    lines.push({ ...rest, units: Math.round(rest.units), amountCents });
    totals.set(line.currency, (totals.get(line.currency) ?? 0) + amountCents);
  }
  lines.sort((a, b) => b.amountCents - a.amountCents);
  return {
    kind: "ok",
    source,
    columns,
    headers,
    statement: {
      lines,
      totals: [...totals].map(([currency, cents]) => ({ currency, cents })),
      periodStart: start,
      periodEnd: end === undefined ? undefined : end - 1,
      rowCount,
      skippedRows,
    },
  };
}
