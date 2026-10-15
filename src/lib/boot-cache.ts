/*
 * Boot cache: what Pulse OS paints before the server has answered.
 *
 * One small record per signed-in person, in localStorage, holding the last
 * dashboard they saw (the query results its tiles rendered from) and the
 * studio's resolved theme (brand colors, Max white-label tokens, Hardware or
 * Glass). On the next cold load the shell paints in the right colors before
 * hydration and the dashboard renders from this record at once, then swaps to
 * live data as Convex answers.
 *
 * Rules this module enforces, so callers cannot get them wrong:
 *  - Scoped to one person AND one studio. A record only reads back for the
 *    same user id and, once the live org is known, the same org id. Opening
 *    the cache for a different person wipes every other person's record.
 *  - Only what that person was already shown: callers record query results
 *    their own screen rendered. Fields that look like contact or payment
 *    details are stripped before anything touches storage, so card numbers,
 *    emails, phone numbers and tokens never land on disk.
 *  - Versioned. A record from another schema version, or one that fails to
 *    parse, is deleted rather than trusted.
 *  - Never throws. Private windows, blocked storage and full quotas all read
 *    as "no cache" and the app renders exactly as it did before.
 *
 * This is presentation only. Every query and mutation still checks the
 * session and the role on the server; a cached screen is inert until the live
 * session is confirmed (see src/components/shell/boot-shell.tsx).
 */

import { APP_ROUTE_SEGMENTS } from "./app-routes";

export { APP_ROUTE_SEGMENTS };

export const BOOT_CACHE_VERSION = 1;
export const BOOT_CACHE_PREFIX = "pulse:boot:";
/** A record over this many bytes is not written (the cache is a convenience). */
export const BOOT_CACHE_MAX_BYTES = 256 * 1024;

export type BootThemeAttr = "uiStyle" | "brandTheme" | "whitelabel" | "themeMode";
export const BOOT_THEME_ATTRS: readonly BootThemeAttr[] = ["uiStyle", "brandTheme", "whitelabel", "themeMode"];

export type BootTheme = {
  /** CSS custom properties the live theme wrote onto <html>. */
  vars: Record<string, string>;
  /** data-* attributes on <html> the stylesheets key on. */
  attrs: Partial<Record<BootThemeAttr, string>>;
  /** Google Fonts stylesheets the white-label theme loads. */
  fonts: string[];
};

export type BootRecord = {
  v: typeof BOOT_CACHE_VERSION;
  userId: string;
  orgId: string;
  savedAt: number;
  theme?: BootTheme;
  /** Query results keyed by queryKey(name, args). */
  queries: Record<string, unknown>;
};

/** The slice of Storage this module uses; injectable for tests. */
export type BootStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function bootCacheKey(userId: string): string {
  return `${BOOT_CACHE_PREFIX}v${BOOT_CACHE_VERSION}:${userId}`;
}

/** localStorage, or null when it is missing or throws on access. */
export function safeStorage(): BootStorage | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** Stable key for a query + its args (object keys sorted). */
export function queryKey(name: string, args: unknown): string {
  return `${name}:${stableStringify(args ?? {})}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/* Field names that never go to disk, whatever query returned them. Matched
   case-insensitively against each key at any depth. */
const SENSITIVE_KEY =
  /(e-?mail|phone|mobile|card|last4|iban|routing|account_?number|bank|token|secret|password|ssn|tax_?id|payment_?method|client_?secret|stripe_?customer|address|signature)/i;

/**
 * A deep copy safe to persist: sensitive-looking keys dropped, functions and
 * symbols dropped, depth and array length bounded. Convex values are plain
 * JSON (plus bigint / ArrayBuffer, which are dropped here too).
 */
export function sanitizeForCache(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value.length > 4000 ? value.slice(0, 4000) : value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "object": {
      if (Array.isArray(value)) {
        return value.slice(0, 200).map((v) => {
          const out = sanitizeForCache(v, depth + 1);
          return out === undefined ? null : out;
        });
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEY.test(k)) continue;
        const clean = sanitizeForCache(v, depth + 1);
        if (clean !== undefined) out[k] = clean;
      }
      return out;
    }
    default:
      return undefined;
  }
}

const VAR_NAME = /^--[a-zA-Z0-9-]{1,64}$/;
const VAR_VALUE = /^[^<>{};\\]{0,300}$/;
const ATTR_VALUE = /^[a-z0-9-]{1,24}$/;
const FONT_URL = /^https:\/\/fonts\.googleapis\.com\/[^"'<>\s]{1,400}$/;

/** Only well-formed custom properties, attribute values and font URLs. */
export function sanitizeTheme(input: unknown): BootTheme | undefined {
  if (!input || typeof input !== "object") return undefined;
  const t = input as Partial<BootTheme>;
  const vars: Record<string, string> = {};
  if (t.vars && typeof t.vars === "object") {
    for (const [k, v] of Object.entries(t.vars)) {
      if (VAR_NAME.test(k) && typeof v === "string" && VAR_VALUE.test(v)) vars[k] = v;
    }
  }
  const attrs: Partial<Record<BootThemeAttr, string>> = {};
  if (t.attrs && typeof t.attrs === "object") {
    for (const a of BOOT_THEME_ATTRS) {
      const v = (t.attrs as Record<string, unknown>)[a];
      if (typeof v === "string" && ATTR_VALUE.test(v)) attrs[a] = v;
    }
  }
  const fonts = Array.isArray(t.fonts) ? t.fonts.filter((f): f is string => typeof f === "string" && FONT_URL.test(f)).slice(0, 4) : [];
  return { vars, attrs, fonts };
}

function isRecord(x: unknown): x is BootRecord {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<BootRecord>;
  return (
    r.v === BOOT_CACHE_VERSION &&
    typeof r.userId === "string" &&
    typeof r.orgId === "string" &&
    typeof r.savedAt === "number" &&
    !!r.queries &&
    typeof r.queries === "object" &&
    !Array.isArray(r.queries)
  );
}

/**
 * The person's record, or null. Pass `orgId` once the live org is known: a
 * record for another studio is deleted and reads as null. Unparseable and
 * wrong-version records are deleted too.
 */
export function readBootRecord(
  storage: BootStorage | null,
  userId: string,
  orgId?: string | null,
): BootRecord | null {
  if (!storage || !userId) return null;
  const key = bootCacheKey(userId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove(storage, key);
    return null;
  }
  if (!isRecord(parsed) || parsed.userId !== userId) {
    safeRemove(storage, key);
    return null;
  }
  if (orgId && parsed.orgId !== orgId) {
    safeRemove(storage, key);
    return null;
  }
  return { ...parsed, theme: sanitizeTheme(parsed.theme) };
}

/** Writes the record (sanitized, size-capped). False when nothing was written. */
export function writeBootRecord(storage: BootStorage | null, record: BootRecord): boolean {
  if (!storage || !record.userId || !record.orgId) return false;
  const queries: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record.queries)) {
    const clean = sanitizeForCache(v);
    if (clean !== undefined) queries[k] = clean;
  }
  const out: BootRecord = {
    v: BOOT_CACHE_VERSION,
    userId: record.userId,
    orgId: record.orgId,
    savedAt: record.savedAt,
    theme: sanitizeTheme(record.theme),
    queries,
  };
  let json: string;
  try {
    json = JSON.stringify(out);
  } catch {
    return false;
  }
  if (json.length > BOOT_CACHE_MAX_BYTES) return false;
  try {
    storage.setItem(bootCacheKey(record.userId), json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes every boot record (any version), except the given person's current
 * one when `keepUserId` is passed. Call with no argument on sign-out.
 */
export function clearBootCache(storage: BootStorage | null, keepUserId?: string | null): void {
  if (!storage) return;
  const keep = keepUserId ? bootCacheKey(keepUserId) : null;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(BOOT_CACHE_PREFIX) && k !== keep) doomed.push(k);
    }
  } catch {
    return;
  }
  for (const k of doomed) safeRemove(storage, k);
}

function safeRemove(storage: BootStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    /* storage unavailable: nothing to clean */
  }
}

/* ── First paint ─────────────────────────────────────────────────────── */

export const BOOT_THEME_STYLE_ID = "pulse-boot-theme";


/**
 * The inline script the root layout puts ahead of the page's markup. On an
 * app route (APP_ROUTE_SEGMENTS) it reads this person's record and paints
 * its theme before the first frame. The custom properties go into a <style>
 * rule marked !important: the live theme writes them as inline styles on
 * <html>, which outrank every stylesheet rule (hardware.css remaps the ink
 * ladder under `:root:has(.pulse-hw)`), and !important is the only way a
 * stylesheet rule matches that. The rule is removed the moment the live
 * theme is known (releaseBootTheme), so it never outlives the cache. The data
 * attributes go onto <html>, and the fonts start loading. It re-validates every value with the same patterns as
 * sanitizeTheme. A record for anyone else is ignored.
 */
export function bootThemeScript(userId: string | null): string {
  if (!userId) return "";
  const key = JSON.stringify(bootCacheKey(userId)).replace(/</g, "\\u003c");
  const uid = JSON.stringify(userId).replace(/</g, "\\u003c");
  const attrs = JSON.stringify(BOOT_THEME_ATTRS);
  return (
    "(function(){try{" +
    `if(${JSON.stringify(APP_ROUTE_SEGMENTS)}.indexOf(location.pathname.split('/')[1])<0)return;` +
    `var r=JSON.parse(localStorage.getItem(${key})||"null");` +
    `if(!r||r.v!==${BOOT_CACHE_VERSION}||r.userId!==${uid}||!r.theme)return;` +
    "var t=r.theme,d=document.documentElement,css='',set=[];" +
    `var N=${VAR_NAME},V=${VAR_VALUE},A=${ATTR_VALUE},F=${FONT_URL};` +
    "for(var k in t.vars||{}){var v=t.vars[k];if(N.test(k)&&typeof v==='string'&&V.test(v))css+=k+':'+v+' !important;';}" +
    `var as=${attrs};for(var i=0;i<as.length;i++){var a=as[i],x=t.attrs&&t.attrs[a];if(typeof x==='string'&&A.test(x)&&!(a in d.dataset)){d.dataset[a]=x;set.push(a);}}` +
    "if(css){var s=document.createElement('style');s.id=" +
    JSON.stringify(BOOT_THEME_STYLE_ID) +
    ";s.textContent='html:root{'+css+'}';document.head.appendChild(s);}" +
    "(t.fonts||[]).slice(0,4).forEach(function(f){if(typeof f==='string'&&F.test(f)){var l=document.createElement('link');l.rel='stylesheet';l.href=f;document.head.appendChild(l);}});" +
    "if(set.length)d.dataset.bootAttrs=set.join(',');" +
    "}catch(e){}})();"
  );
}

/**
 * Hands first paint back to the live theme: drops the boot <style> rule. The
 * data attributes the boot script set are left alone; their live owners
 * (OrgTheme, WhiteLabelTheme, useUiStyleRoot) set or clear each one once
 * their data is known, so removing them here could undo a live value.
 */
export function releaseBootTheme(doc: Document): void {
  try {
    doc.getElementById(BOOT_THEME_STYLE_ID)?.remove();
    delete doc.documentElement.dataset.bootAttrs;
  } catch {
    /* nothing to release */
  }
}

/** The live theme as it stands on <html>, for the next first paint. */
export function captureBootTheme(doc: Document): BootTheme | undefined {
  try {
    const root = doc.documentElement;
    const vars: Record<string, string> = {};
    for (let i = 0; i < root.style.length; i++) {
      const prop = root.style.item(i);
      if (prop.startsWith("--")) vars[prop] = root.style.getPropertyValue(prop).trim();
    }
    const attrs: Partial<Record<BootThemeAttr, string>> = {};
    for (const a of BOOT_THEME_ATTRS) {
      const v = root.dataset[a];
      if (v) attrs[a] = v;
    }
    const fonts = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href^="https://fonts.googleapis.com/"]'))
      .map((l) => l.href)
      .slice(0, 4);
    return sanitizeTheme({ vars, attrs, fonts });
  } catch {
    return undefined;
  }
}
