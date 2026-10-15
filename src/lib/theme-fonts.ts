/* ============================================================
   Where each white-label font comes from, and how it reaches the page.

   THEME_FONTS (convex/lib/themeSpec.ts) is the allowlist the server
   validates against. Before this file nothing loaded them: the theme set
   `--font-grotesk: "Sora"` and the browser fell back to a system face
   unless the studio happened to have Sora installed. Every font here is
   free to use. Twelve come from Google Fonts, the same CSS2 endpoint the
   app's share cards and printed signs already call; Satoshi and General
   Sans are not on Google Fonts and come from Fontshare (Indian Type
   Foundry's free library, same CSS-link model, no key).

   A stylesheet is only added when a font is actually needed: the theme
   uses it, or its option scrolls into view in the font picker.
   ============================================================ */

import { THEME_FONTS, isThemeFont, type ThemeFont } from "@convex/lib/themeSpec";

type FontSource = {
  provider: "google" | "fontshare";
  /** Generic family for the fallback stack, so a slow load degrades to
   *  something with the same shape. */
  kind: "sans" | "serif" | "mono";
};

export const THEME_FONT_SOURCES: Record<ThemeFont, FontSource> = {
  Inter: { provider: "google", kind: "sans" },
  Geist: { provider: "google", kind: "sans" },
  Satoshi: { provider: "fontshare", kind: "sans" },
  "General Sans": { provider: "fontshare", kind: "sans" },
  Manrope: { provider: "google", kind: "sans" },
  "Space Grotesk": { provider: "google", kind: "sans" },
  "IBM Plex Sans": { provider: "google", kind: "sans" },
  Sora: { provider: "google", kind: "sans" },
  Outfit: { provider: "google", kind: "sans" },
  "DM Sans": { provider: "google", kind: "sans" },
  "Playfair Display": { provider: "google", kind: "serif" },
  Fraunces: { provider: "google", kind: "serif" },
  "Instrument Serif": { provider: "google", kind: "serif" },
  "JetBrains Mono": { provider: "google", kind: "mono" },
};

/** Fonts that only ship one weight on Google Fonts. Asking for more makes the
 *  CSS2 endpoint answer 400 for the whole stylesheet. */
const SINGLE_WEIGHT = new Set<ThemeFont>(["Instrument Serif"]);

/** Fontshare weights per family (they differ, and an unknown one 404s). */
const FONTSHARE: Partial<Record<ThemeFont, { slug: string; weights: string }>> = {
  Satoshi: { slug: "satoshi", weights: "400,500,700" },
  "General Sans": { slug: "general-sans", weights: "400,500,600,700" },
};

/** The stylesheet URL for a font, or null for anything off the allowlist. */
export function fontStylesheetHref(font: string): string | null {
  if (!isThemeFont(font)) return null;
  const src = THEME_FONT_SOURCES[font];
  if (src.provider === "fontshare") {
    const fs = FONTSHARE[font]!;
    return `https://api.fontshare.com/v2/css?f[]=${fs.slug}@${fs.weights}&display=swap`;
  }
  const family = font.replace(/ /g, "+");
  const axis = SINGLE_WEIGHT.has(font) ? "" : ":wght@400;500;600;700";
  return `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`;
}

/** A CSS font-family value for a theme font, with a fallback of the same kind. */
export function fontStack(font: string): string {
  const kind = isThemeFont(font) ? THEME_FONT_SOURCES[font].kind : "sans";
  const tail =
    kind === "serif"
      ? "ui-serif, Georgia, serif"
      : kind === "mono"
        ? "ui-monospace, Menlo, monospace"
        : "ui-sans-serif, system-ui, sans-serif";
  return `"${font}", ${tail}`;
}

/**
 * The custom properties a font choice writes. Headings drive the display
 * voices (grotesk, chrome, display). Body drives the text voice, including
 * --font-archivo, the hardware UI face that keys, nav and readouts read
 * directly; without it a Body choice changed nothing inside the app shell.
 * An empty or unknown font writes nothing, so the Pulse faces stay.
 */
export function themeFontVars(
  heading: string | null | undefined,
  body: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (heading && isThemeFont(heading)) {
    const h = fontStack(heading);
    out["--font-grotesk"] = h;
    out["--font-chrome"] = h;
    out["--font-display"] = h;
  }
  if (body && isThemeFont(body)) {
    const b = fontStack(body);
    out["--font-inter"] = b;
    out["--font-sans"] = b;
    out["--font-archivo"] = b;
  }
  return out;
}

/** Every key themeFontVars can write, so a theme can be cleanly removed. */
export const THEME_FONT_VAR_KEYS = [
  "--font-grotesk",
  "--font-chrome",
  "--font-display",
  "--font-inter",
  "--font-sans",
  "--font-archivo",
] as const;

/**
 * Adds a font's stylesheet to a document once. Safe to call on every render:
 * a second call for the same font finds the first link and returns.
 */
export function ensureFontStylesheet(doc: Document, font: string | null | undefined): void {
  if (!font) return;
  const href = fontStylesheetHref(font);
  if (!href) return;
  const existing = doc.head.querySelectorAll<HTMLLinkElement>("link[data-theme-font]");
  for (const link of existing) if (link.dataset.themeFont === font) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.themeFont = font;
  doc.head.appendChild(link);
}

export { THEME_FONTS };
