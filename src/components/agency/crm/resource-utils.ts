/* Pure helpers behind the config-driven CRM screens (resource-panel.tsx) and the
   Functions form (crm-op-form.tsx). No React, no Convex, no registry: everything
   here is plain data in, plain data out, so it is unit tested directly. */

import type { FieldDef } from "./resource-config";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = Record<string, unknown>;

export const isObj = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);

/* ---------- reading answers ---------- */

/** A value at a dotted path. `a|b` tries each alternative in turn and returns the
 *  first one that is present (Zuops names a few fields differently per area).
 *  `a+b` joins the text of both with a space (first_name+last_name). */
export function getPath(source: unknown, key: string): unknown {
  for (const alt of key.split("|")) {
    if (alt.includes("+")) {
      const parts = alt.split("+").map((k) => getPath(source, k)).filter((v) => typeof v === "string" || typeof v === "number").map(String).filter((v) => v.trim() !== "");
      if (parts.length) return parts.join(" ");
      continue;
    }
    let cur: unknown = source;
    for (const part of alt.split(".")) {
      if (!isObj(cur)) { cur = undefined; break; }
      cur = cur[part];
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

/** `id` or `something_id`: a key that holds an id, not something to read. */
export const isIdKey = (key: string) => {
  const k = key.split("|")[0].split(".").pop() ?? key;
  return k === "id" || k.endsWith("_id") || k === "uuid";
};

/** Columns in reading order: an id column never leads the table (it moves
 *  last), even when the config names it. */
export function leadWithMeaning<C extends { key: string }>(columns: readonly C[]): C[] {
  if (columns.length < 2 || !isIdKey(columns[0].key)) return [...columns];
  const firstReal = columns.findIndex((c) => !isIdKey(c.key));
  if (firstReal < 0) return [...columns];
  return [...columns.filter((c) => !isIdKey(c.key)), ...columns.filter((c) => isIdKey(c.key))];
}

/** Columns for an answer no config describes: the plain values of its rows,
 *  never id keys (those stay in the record), never secrets. */
export function autoColumns(rows: readonly Obj[], max = 6): string[] {
  return [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r)))]
    .filter((k) => k !== "workspace_id" && !isIdKey(k) && !isSecretKey(k) && rows.some((r) => r[k] !== null && r[k] !== undefined && typeof r[k] !== "object"))
    .slice(0, max);
}

const DAYS: ReadonlyArray<readonly [string, string, string]> = [
  ["mon", "monday", "Mon"], ["tue", "tuesday", "Tue"], ["wed", "wednesday", "Wed"], ["thu", "thursday", "Thu"],
  ["fri", "friday", "Fri"], ["sat", "saturday", "Sat"], ["sun", "sunday", "Sun"],
];

function rangeText(r: unknown): string | null {
  if (Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === "string")) return `${r[0]} to ${r[1]}`;
  if (isObj(r)) {
    const a = getPath(r, "start|from|open|opens");
    const b = getPath(r, "end|to|close|closes");
    if (typeof a === "string" && typeof b === "string") return `${a} to ${b}`;
  }
  if (typeof r === "string" && r.trim()) return r.replace(/\s*[-–]\s*/, " to ");
  return null;
}

/** A day -> time ranges map (weekly business hours) as rows, Monday first:
 *  [["Mon", "09:00 to 17:00"], ["Sat", "Closed"]]. Null when the value is not
 *  that shape. */
export function weeklyHours(v: unknown): Array<[string, string]> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v).map((k) => k.toLowerCase());
  if (keys.length === 0) return null;
  const known = (k: string) => DAYS.some(([a, b]) => k === a || k === b);
  if (!keys.every(known)) return null;
  const out: Array<[string, string]> = [];
  for (const [short, long, word] of DAYS) {
    const key = Object.keys(v).find((k) => k.toLowerCase() === short || k.toLowerCase() === long);
    if (key === undefined) continue;
    const day = v[key];
    const ranges = Array.isArray(day)
      ? (day.length === 2 && day.every((x) => typeof x === "string" && !/[-–]/.test(x)) ? [day] : day)
      : day === null || day === undefined || day === false || day === "" ? [] : [day];
    const parts = ranges.map(rangeText);
    if (parts.some((x) => x === null)) return null;
    out.push([word, parts.length ? (parts as string[]).join(", ") : "Closed"]);
  }
  return out;
}

const NAME_KEYS = "name|label|title|full_name|question|key|keyword|email|phone_number";

/** The name of the record with this id, when the same answer carries it
 *  (a sibling `x_name`, an embedded `{ id, name }`). Null otherwise. */
export function nameForId(root: unknown, key: string, id: string): string | null {
  if (isObj(root) && key.endsWith("_id")) {
    const base = key.slice(0, -3);
    for (const k of [`${base}_name`, `${base}_label`, `${base}_title`]) {
      const v = root[k];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  let found: string | null = null;
  const walk = (x: unknown, depth: number) => {
    if (found || depth > 6) return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (!isObj(x)) return;
    if (x.id === id) {
      const n = getPath(x, NAME_KEYS);
      if (typeof n === "string" && n.trim()) { found = n; return; }
    }
    for (const y of Object.values(x)) walk(y, depth + 1);
  };
  walk(root, 0);
  return found;
}

const plainText = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.filter((x) => x !== null && x !== "").map((x) => plainText(x)).join(", ");
  return null;
};

/** Answers as "label: value" pairs: a list of `{ question|label|key, value }`,
 *  or an object of plain values. Ids, empty answers and nested blobs are left
 *  out. */
export function answerPairs(v: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!isObj(item)) continue;
      const label = getPath(item, "question|label|title|name|key");
      const value = plainText(getPath(item, "value|answer|response"));
      if (typeof label === "string" && value !== null && value !== "") out.push([label.replace(/_/g, " "), value]);
    }
    return out;
  }
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (isIdKey(k) || isSecretKey(k)) continue;
      const value = plainText(x);
      if (value !== null && value !== "") out.push([humanize(k), value]);
    }
  }
  return out;
}

/** The parts of an object worth a one-line summary: its name first, then up
 *  to `max` other plain values as "Label: value". Ids are left out. */
export function summaryParts(o: Obj, max = 3): { title: string | null; rest: Array<[string, string]> } {
  const titleKey = NAME_KEYS.split("|").find((k) => typeof o[k] === "string" && (o[k] as string).trim() !== "");
  const rest: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === titleKey || isIdKey(k) || isSecretKey(k) || k === "workspace_id") continue;
    const t = plainText(v);
    if (t === null || t === "") continue;
    rest.push([humanize(k), t.length > 80 ? `${t.slice(0, 79)}…` : t]);
    if (rest.length >= max) break;
  }
  return { title: titleKey ? String(o[titleKey]) : null, rest };
}

/** The rows of a list answer: `data[rowsKey]`, else the first array in it. */
export function extractRows(data: unknown, rowsKey?: string): Obj[] {
  if (Array.isArray(data)) return data.filter(isObj);
  if (!isObj(data)) return [];
  if (rowsKey) {
    const v = getPath(data, rowsKey);
    return Array.isArray(v) ? v.filter(isObj) : [];
  }
  for (const v of Object.values(data)) if (Array.isArray(v)) return v.filter(isObj);
  return [];
}

/** One settings object out of an answer like `{ configured, ai_texting: {...} }`:
 *  when exactly one property is a plain object, that object, with the top-level
 *  plain values (configured, has_phone_number) kept beside it. */
export function unwrapSingle(data: unknown): Obj | null {
  if (!isObj(data)) return null;
  const objects = Object.entries(data).filter(([, v]) => isObj(v));
  if (objects.length !== 1) return data;
  const top: Obj = {};
  for (const [k, v] of Object.entries(data)) if (!isObj(v) && !Array.isArray(v)) top[k] = v;
  return { ...top, ...(objects[0][1] as Obj) };
}

/** Keys whose values are never shown: secrets, tokens, key prefixes. */
export function isSecretKey(key: string): boolean {
  return /secret|token|password|prefix|api_?key|signing|hash/i.test(key);
}

/** A copy of an answer with every secret-looking text value replaced by
 *  "hidden", at any depth. Numbers and yes/no values stay (token counts,
 *  has_password). `keep` names keys shown as they are (the one-time signing
 *  secret in the create-webhook answer). */
export function redactSecrets(data: unknown, keep: readonly string[] = [], depth = 0): unknown {
  if (depth > 40) return "hidden";
  if (Array.isArray(data)) return data.map((v) => redactSecrets(v, keep, depth + 1));
  if (!isObj(data)) return data;
  const out: Obj = {};
  for (const [k, v] of Object.entries(data)) {
    const secret = isSecretKey(k) && !keep.includes(k);
    if (secret && typeof v === "string" && v !== "") out[k] = "hidden";
    else if (secret && Array.isArray(v) && v.some((x) => typeof x === "string")) out[k] = v.map((x) => (typeof x === "string" ? "hidden" : redactSecrets(x, keep, depth + 1)));
    else out[k] = redactSecrets(v, keep, depth + 1);
  }
  return out;
}

/** Is there a value to show (not missing, null or empty text)? */
export const present = (v: unknown) => v !== undefined && v !== null && v !== "";

/** The columns worth drawing: the first always (it opens the row), the rest
 *  only when at least one row has a value there, so a guessed key that Zuops
 *  does not send shows nothing rather than a column of dashes. */
export function visibleColumns<C extends { key: string }>(columns: readonly C[], rows: readonly Obj[]): C[] {
  return columns.filter((c, i) => i === 0 || rows.some((r) => present(getPath(r, c.key))));
}

/** The first value under one of `keys`, searched at any depth (a webhook's
 *  signing secret in the create answer). */
export function findDeep(data: unknown, keys: readonly string[], depth = 0): string | null {
  if (depth > 5) return null;
  if (Array.isArray(data)) {
    for (const v of data) {
      const hit = findDeep(v, keys, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(data)) return null;
  for (const k of keys) if (typeof data[k] === "string" && data[k]) return data[k] as string;
  for (const v of Object.values(data)) {
    const hit = findDeep(v, keys, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** "views_count" -> "Views count". */
export function humanize(key: string): string {
  const s = key.replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

/** What to call a row in a confirm sentence. */
export function rowName(row: Obj | null | undefined, fallback = "this item"): string {
  if (!row) return fallback;
  const v = getPath(row, "name|title|label|subject|full_name|keyword|hostname|question|email|phone_number|id");
  return typeof v === "string" || typeof v === "number" ? String(v) : fallback;
}

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
export const isIsoDate = (s: string) => ISO.test(s) && Number.isFinite(Date.parse(s));
export const isUrl = (s: string) => /^https?:\/\/[^\s]+$/i.test(s);

/* ---------- status words ---------- */

export type Tone = "neutral" | "positive" | "caution" | "critical" | "info";

const POSITIVE = /^(sent|published|active|live|connected|enabled|on|completed|complete|signed|accepted|approved|paid|resolved|won|ready|verified|answered|delivered|converted|winner|yes|true|running|confirmed|redeemed)$/;
const CAUTION = /^(draft|scheduled|pending|paused|sending|open|waiting|review|queued|in_progress|building|editing|unverified|viewed|scheduled_end|too_early|needs_code|brand_pending|campaign_pending|on_hold)$/;
const CRITICAL = /^(failed|error|declined|voided|void|canceled|cancelled|lost|overdue|expired|disabled|off|missed|rejected|needs_fix|closed|used_up|no_show|turned_down|false|no)$/;

export function statusTone(value: unknown): Tone {
  const s = String(value ?? "").toLowerCase();
  if (POSITIVE.test(s)) return "positive";
  if (CAUTION.test(s)) return "caution";
  if (CRITICAL.test(s)) return "critical";
  return s ? "info" : "neutral";
}

/** "no_show" -> "No show". */
export function statusWord(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  const s = String(value ?? "").trim();
  return s ? humanize(s) : "None";
}

/* ---------- confirm text ---------- */


/** Fill `{count}`, `{name}`, `{email_audience}`, any `extra` word and any
 *  `{field}` from the dialog's values. */
export function fillTemplate(text: string, vars: { count?: number | null; name?: string | null; email_audience?: string; values?: Record<string, string>; extra?: Record<string, string> }): string {
  return text.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
    if (k === "count") return vars.count === null || vars.count === undefined ? "an uncounted number of" : vars.count.toLocaleString("en-US");
    if (k === "name") return vars.name || "this item";
    if (k === "email_audience" && vars.email_audience) return vars.email_audience;
    if (vars.extra && Object.prototype.hasOwnProperty.call(vars.extra, k)) return vars.extra[k];
    const v = vars.values?.[k];
    return v !== undefined && v !== "" ? v : k.replace(/_/g, " ");
  });
}

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-|^uuid$/i;
const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** Who an email campaign goes to, in words and never as a number: Zuops only
 *  counts recipients when it sends. The audience picked in the form wins over
 *  the campaign's saved one. */
export function audienceText(values: FormValues, source?: Obj | null): string {
  const picked = (values["body:audience"] ?? "").trim();
  const audience = picked || (typeof source?.audience === "string" ? source.audience : "");
  // Each filter: what the form says when it says something, else what the campaign carries.
  const formTags = splitList(values["body:tags"] ?? "");
  const formStages = splitList(values["body:stages"] ?? "");
  const tags = formTags.length || picked ? formTags : strings(source?.tags);
  const stages = formStages.length || picked ? formStages : strings(source?.stages);
  const nb = values["body:not_booked"] ?? "";
  const notBooked = nb === "yes" ? true : nb === "no" ? false : picked ? false : source?.not_booked === true;
  const named = (xs: string[]) => xs.length > 0 && xs.every((x) => !UUIDISH.test(x));
  const booked = notBooked ? " who has not booked" : "";
  switch (audience) {
    case "everyone": return `everyone with an email address${booked}`;
    case "not_booked": return "everyone with an email address who has not booked";
    case "stages": return `${named(stages) ? `everyone in the stages ${joinWords(stages)}` : "everyone in the campaign's chosen stages"}${booked}`;
    case "tags": return `${named(tags) ? `everyone tagged ${joinWords(tags)}` : "everyone with the campaign's chosen tags"}${booked}`;
    default: return `everyone in the campaign's saved audience${booked}`;
  }
}

/** How a send is paced, in words ("" when it all goes at once): the drip in
 *  the form, else the campaign's. */
export function dripText(values: FormValues, source?: Obj | null): string {
  let drip: unknown = source?.drip;
  const raw = (values["body:drip"] ?? "").trim();
  if (raw) {
    try { drip = JSON.parse(raw); } catch { drip = null; }
  }
  if (!isObj(drip)) return "";
  const every = drip.every;
  const minutes = drip.minutes;
  if (typeof every !== "number" || typeof minutes !== "number") return "";
  const gap = minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}` : `${minutes} minutes`;
  return ` A few at a time: ${every.toLocaleString("en-US")} ${every === 1 ? "email" : "emails"} every ${gap}.`;
}

/** "now", or "at Nov 12, 9:00 AM" when the form sets a time. */
export function sendWhen(values: FormValues, field = "schedule_at"): string {
  const raw = (values[`body:${field}`] ?? "").trim();
  if (!raw) return "now";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? `at ${whenWords(ms)}` : "at the time you set";
}

export function whenWords(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---------- idempotency ---------- */

/** A stable text for a form's values, keys sorted, so the same values always
 *  give the same fingerprint (fed to useIdemFor). */
export function fingerprint(x: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  return JSON.stringify(norm(x)) ?? "";
}

/* ---------- forms ---------- */

/** What a field holds in the form: text for every control, booleans as
 *  "yes", "no" or "" (not set). */
export type FormValues = Record<string, string>;

export const UNSET = "";

export const fieldKey = (f: Pick<FieldDef, "name" | "in">) => `${f.in ?? "body"}:${f.name}`;

export function splitList(s: string): string[] {
  return s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** An ISO time as the value a `datetime-local` input wants, in local time. */
export function toLocalInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The form's starting text for a field, from a row or settings object. */
export function toFormValue(f: FieldDef, v: unknown): string {
  if (v === undefined || v === null) return UNSET;
  if (f.type === "boolean") return v === true ? "yes" : v === false ? "no" : UNSET;
  if (f.type === "json") return JSON.stringify(v, null, 2);
  if (f.list && Array.isArray(v)) return v.map((x) => (isObj(x) ? String(x.name ?? x.id ?? "") : String(x))).filter(Boolean).join(", ");
  if (f.type === "datetime" && typeof v === "string") return toLocalInput(v);
  if (f.type === "date" && typeof v === "string") return v.slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function prefill(fields: readonly FieldDef[], source: Obj | null | undefined): FormValues {
  const out: FormValues = {};
  for (const f of fields) out[fieldKey(f)] = source && (f.in ?? "body") === "body" ? toFormValue(f, source[f.name]) : UNSET;
  return out;
}

export type BuiltArgs = {
  path: Record<string, string>;
  query: Record<string, string | number | boolean>;
  body: Obj;
};

/** The parsed value of one field, or the reason it cannot be sent. `skip` means
 *  the field was left empty and is not sent. */
export function parseField(f: FieldDef, raw: string | undefined): { value: unknown } | { skip: true } | { error: string } {
  const s = (raw ?? "").trim();
  if (s === "") return { skip: true };
  switch (f.type) {
    case "number": {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? { value: n } : { error: `${f.label} must be a number.` };
    }
    case "boolean":
      return s === "yes" ? { value: true } : s === "no" ? { value: false } : { skip: true };
    case "json":
      try {
        return { value: JSON.parse(s) };
      } catch {
        return { error: `${f.label} is not valid JSON. Check the brackets and quotes.` };
      }
    case "datetime": {
      const ms = Date.parse(s);
      return Number.isFinite(ms) ? { value: new Date(ms).toISOString() } : { error: `${f.label} is not a date and time.` };
    }
    default:
      if (f.list) return { value: splitList(s) };
      return { value: s };
  }
}

/** Turn the form into path, query and body. `fixed` is merged under the fields.
 *  `initial` (from a row or settings object) makes it send only what changed. */
export function buildArgs(
  fields: readonly FieldDef[],
  values: FormValues,
  opts: {
    fixed?: Obj;
    path?: Record<string, string>;
    initial?: FormValues;
    enforceRequired?: (f: FieldDef) => boolean;
  } = {},
): BuiltArgs | { error: string } {
  const out: BuiltArgs = { path: { ...(opts.path ?? {}) }, query: {}, body: { ...(opts.fixed ?? {}) } };
  const enforce = opts.enforceRequired ?? (() => true);
  let changed = 0;
  for (const f of fields) {
    const k = fieldKey(f);
    const raw = values[k] ?? UNSET;
    const where = f.in ?? "body";
    if (opts.initial && where === "body" && (opts.initial[k] ?? UNSET) === raw) continue;
    const parsed = parseField(f, raw);
    if ("error" in parsed) return parsed;
    if ("skip" in parsed) {
      if (f.required && enforce(f)) return { error: requiredMessage(f) };
      // Clearing a prefilled text field is a real change: send null.
      if (opts.initial && where === "body" && (opts.initial[k] ?? UNSET) !== UNSET && f.type !== "boolean") {
        out.body[f.name] = null;
        changed += 1;
      }
      continue;
    }
    if (f.type === "json" && f.jsonShape) {
      const ok = f.jsonShape === "array" ? Array.isArray(parsed.value) : isObj(parsed.value);
      if (!ok) return { error: `${f.label} must be a JSON ${f.jsonShape === "array" ? "list ([ ... ])" : "object ({ ... })"}.` };
    }
    changed += 1;
    if (where === "path") {
      const v = String(parsed.value);
      if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(v) || v === "." || v === "..") return { error: `${f.label} has characters that are not allowed.` };
      out.path[f.name] = v;
    } else if (where === "query") {
      const v = parsed.value;
      out.query[f.name] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
    } else {
      out.body[f.name] = parsed.value;
    }
  }
  if (opts.initial && changed === 0 && fields.length > 0) return { error: "Nothing changed." };
  return out;
}

/** The inline message for a required field left empty. */
export function requiredMessage(f: Pick<FieldDef, "label" | "type">): string {
  return f.type === "select" ? `Choose a value for ${f.label}.` : `${f.label} is required.`;
}

/** Merge a free JSON object into the body (Functions: operations that accept
 *  fields the spec does not list). */
export function mergeExtra(body: Obj, extra: string): { body: Obj } | { error: string } {
  const s = extra.trim();
  if (!s) return { body };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { error: "More fields is not valid JSON. Check the brackets and quotes." };
  }
  if (!isObj(parsed)) return { error: "More fields must be a JSON object ({ ... })." };
  return { body: { ...parsed, ...body } };
}

/* ---------- paging ---------- */

export type PageState = { offset: number; cursors: string[] };
export const FIRST_PAGE: PageState = { offset: 0, cursors: [] };

/** The query additions for the page being shown. */
export function pageQuery(mode: "offset" | "cursor" | "none" | undefined, page: PageState): Obj {
  if (mode === "offset" && page.offset > 0) return { offset: page.offset };
  if (mode === "cursor" && page.cursors.length) return { cursor: page.cursors[page.cursors.length - 1] };
  return {};
}

/** The next page, or null when the answer says there is none. */
export function nextPage(mode: "offset" | "cursor" | "none" | undefined, page: PageState, data: unknown, rowCount: number, limit: number): PageState | null {
  if (!isObj(data) || mode === "none" || !mode) return null;
  if (mode === "offset") {
    if (data.has_more === false) return null;
    const next = typeof data.next_offset === "number" ? data.next_offset : data.has_more ? page.offset + (limit || rowCount) : null;
    return next === null || next <= page.offset ? null : { ...page, offset: next };
  }
  const cursor = data.next_cursor;
  if (typeof cursor !== "string" || !cursor || data.has_more === false) return null;
  return { ...page, cursors: [...page.cursors, cursor] };
}

export function prevPage(mode: "offset" | "cursor" | "none" | undefined, page: PageState, limit: number): PageState | null {
  if (mode === "offset") return page.offset > 0 ? { ...page, offset: Math.max(0, page.offset - limit) } : null;
  if (mode === "cursor") return page.cursors.length ? { ...page, cursors: page.cursors.slice(0, -1) } : null;
  return null;
}

/** Does a row pass an action's `show` condition? */
export function shows(show: { key: string; in: ReadonlyArray<string | number | boolean | null> } | undefined, row: Obj | null | undefined): boolean {
  if (!show) return true;
  if (!row) return false;
  const v = getPath(row, show.key);
  return show.in.includes((v ?? null) as string | number | boolean | null);
}
