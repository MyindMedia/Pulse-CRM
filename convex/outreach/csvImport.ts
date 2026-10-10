/* The outreach CSV (outreach-staged.csv): per-studio copy keyed by website. Pure.

   Columns used (others are ignored): website, studio_name (optional; the name
   the email greets, "Hi <name> team,"), personalization_hook,
   hook_source_url, email_subject, email_body, ig_dm, followup_day3,
   followup_day7, followup_day14, fit_score, priority. email_generic is read
   past and never stored: an address from a spreadsheet is not a contact the
   studio published, and is never imported as one. */

export const MAX_IMPORT_ROWS = 200;

export const IMPORT_COLUMNS = [
  "website", "studio_name", "personalization_hook", "hook_source_url", "email_subject", "email_body", "ig_dm",
  "followup_day3", "followup_day7", "followup_day14", "email_generic", "fit_score", "priority",
] as const;

/* Longest value accepted per field; a longer one skips the row rather than being cut. */
export const IMPORT_LIMITS = { name: 120, hook: 400, hookSourceUrl: 500, subject: 150, body: 1500, followup: 1500, igDm: 600, priority: 40 } as const;

export type ImportRow = {
  line: number;
  website: string;
  name?: string;
  hook?: string;
  hookSourceUrl?: string;
  subject?: string;
  body?: string;
  igDm?: string;
  followups: { step1?: string; step2?: string; step3?: string };
  fitScore?: number;
  priority?: string;
};

/** RFC 4180 CSV: quoted fields, "" escapes, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const tidy = (s: string | undefined) => {
  const v = (s ?? "").replace(/\r\n/g, "\n").trim();
  return v ? v : undefined;
};

/** Header row plus at most MAX_IMPORT_ROWS data rows. Throws on a missing website column or too many rows. */
export function readImportRows(text: string): ImportRow[] {
  const table = parseCsv(text);
  if (table.length === 0) throw new Error("The file is empty");
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("website") < 0) throw new Error("The CSV needs a website column");
  const data = table.slice(1);
  if (data.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time (this file has ${data.length})`);
  const get = (r: string[], name: string) => (col(name) >= 0 ? tidy(r[col(name)]) : undefined);
  return data.map((r, i) => {
    const score = get(r, "fit_score");
    const n = score === undefined ? NaN : Number(score);
    return {
      line: i + 2,
      website: get(r, "website") ?? "",
      name: get(r, "studio_name") ?? get(r, "name"),
      hook: get(r, "personalization_hook"),
      hookSourceUrl: get(r, "hook_source_url"),
      subject: get(r, "email_subject"),
      body: get(r, "email_body"),
      igDm: get(r, "ig_dm"),
      followups: { step1: get(r, "followup_day3"), step2: get(r, "followup_day7"), step3: get(r, "followup_day14") },
      fitScore: Number.isFinite(n) ? n : undefined,
      priority: get(r, "priority"),
    };
  });
}

/** Why a row cannot be stored as is, or null. */
export function rowProblem(r: ImportRow): string | null {
  const L = IMPORT_LIMITS;
  if (!r.website) return "no website";
  if ((r.name?.length ?? 0) > L.name) return "studio_name is too long";
  if (r.name && /^https?:\/\/|^www\./i.test(r.name)) return "studio_name is a web address, not a name";
  if ((r.hook?.length ?? 0) > L.hook) return "personalization_hook is too long";
  if ((r.hookSourceUrl?.length ?? 0) > L.hookSourceUrl) return "hook_source_url is too long";
  if ((r.subject?.length ?? 0) > L.subject) return "email_subject is too long";
  if ((r.body?.length ?? 0) > L.body) return "email_body is too long";
  if ((r.igDm?.length ?? 0) > L.igDm) return "ig_dm is too long";
  if ((r.priority?.length ?? 0) > L.priority) return "priority is too long";
  for (const [k, v] of Object.entries(r.followups)) if ((v?.length ?? 0) > L.followup) return `${k === "step1" ? "followup_day3" : k === "step2" ? "followup_day7" : "followup_day14"} is too long`;
  return null;
}
