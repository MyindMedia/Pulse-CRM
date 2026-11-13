import { ConvexError } from "convex/values";
import { formatBytes } from "@/lib/format-bytes";
import { moneyExact } from "@/lib/format";

/* Pure helpers for the public delivery page (/delivery/<token>). Nothing here
   touches the network, the token or a file URL. */

/** The Pulse gold, used when a studio has no accent of its own. */
export const PULSE_GOLD = "#fdb913";
const GOLD_INK = "#241900";
const DARK_INK = "#1a1a1f";
const LIGHT_INK = "#ffffff";
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Only a plain hex color may reach a style attribute. Anything else (a
 *  name, a url(), an expression) falls back to the Pulse gold. Returns the
 *  six digit, lowercase form. */
export function safeAccent(value: unknown): string {
  if (typeof value !== "string") return PULSE_GOLD;
  const v = value.trim();
  if (!HEX_RE.test(v)) return PULSE_GOLD;
  const h = v.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

function luminance(hex: string): number {
  const h = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Button text on the accent: dark ink on light accents, light ink on dark
 *  ones, whichever reads better (WCAG contrast). Takes a safeAccent value. */
export function inkFor(accent: string): string {
  const dark = accent === PULSE_GOLD ? GOLD_INK : DARK_INK;
  const bg = luminance(accent);
  return contrast(bg, luminance(dark)) >= contrast(bg, 1) ? dark : LIGHT_INK;
}

/** Decimal file sizes, the same text as the delivery email (one source). */
export { formatBytes };

/** "$180.00": always two decimals, as in the email. */
export function usd(cents: number): string {
  return moneyExact(cents);
}

export type FileKind = "audio" | "video" | "archive" | "image" | "doc" | "file";

const ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);
const DOC_EXT = new Set(["pdf", "txt", "rtf", "doc", "docx", "md", "csv"]);

function extension(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function fileKind(name: string, mimeType: string): FileKind {
  const mime = (mimeType || "").toLowerCase();
  const ext = extension(name);
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (ARCHIVE_EXT.has(ext) || /zip|compressed|x-tar|x-7z|x-rar|gzip/.test(mime)) return "archive";
  if (mime.startsWith("image/")) return "image";
  if (DOC_EXT.has(ext) || mime === "application/pdf" || mime.startsWith("text/")) return "doc";
  return "file";
}

/** Only audio gets an inline player. */
export function isPlayable(mimeType: string): boolean {
  return (mimeType || "").toLowerCase().startsWith("audio/");
}

/** "WAV", "ZIP", "PDF": from the extension, else the media type. */
export function typeLabel(name: string, mimeType: string): string {
  const ext = extension(name);
  if (ext) return ext.toUpperCase();
  const sub = (mimeType || "").split("/")[1]?.replace(/^x-/, "").split(/[;+.-]/)[0];
  return sub ? sub.toUpperCase().slice(0, 6) : "FILE";
}

/** "Myind Sound" -> "MS". At most two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "S";
}

/** A small, stable number from a string (for the decorative waveform). */
export function seedFor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return (h % 97) + 3;
}

export const WAVE_BARS = 64;

/** Bar heights in percent, deterministic from the seed (the mockup's wave()). */
export function waveHeights(seed: number): number[] {
  const out: number[] = [];
  let x = seed * 9301 + 49297;
  for (let i = 0; i < WAVE_BARS; i++) {
    x = (x * 9301 + 49297) % 233280;
    const v = 18 + Math.round((x / 233280) * 82 * (0.55 + 0.45 * Math.sin(i / 9 + seed)));
    out.push(Math.max(12, Math.min(100, v)));
  }
  return out;
}

/** A URL the page may navigate to or load: https anywhere, http only on this
 *  machine (local development). Anything else is dropped. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return u.toString();
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.toString();
  } catch {
    /* not a URL */
  }
  return null;
}

/** The server's own message for a refused call (a ConvexError with a short
 *  string), else a generic line. Never a raw error, a request id or a URL. */
export function serverMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  if (err instanceof ConvexError) {
    const d = err.data as unknown;
    const msg =
      typeof d === "string"
        ? d
        : d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string"
          ? (d as { message: string }).message
          : "";
    if (msg.trim() && msg.length <= 160 && !/https?:|\/\//i.test(msg)) return msg.trim();
  }
  return fallback;
}
