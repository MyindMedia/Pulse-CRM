/* Rendering received email HTML safely in the Agency Email tab.

   Two independent layers:
   1. sanitizeEmailHtml (here): drops active content and, by default, remote
      images (tracking pixels).
   2. emailSrcDoc + the caller's <iframe sandbox>: no scripts, opaque origin,
      and a CSP that only allows images the reader opted into.
   The sandboxed iframe is the real boundary; the sanitizer is belt and braces. */

const DANGEROUS_BLOCKS = ["script", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template", "form", "textarea", "select", "button", "svg", "math"];
const DANGEROUS_VOID = ["link", "meta", "base", "input", "param", "source", "track", "frame"];

export type SanitizeOptions = { allowRemoteImages?: boolean };

export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): string {
  let out = html;
  // Comments and conditional comments can hide markup.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DANGEROUS_BLOCKS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }
  for (const tag of DANGEROUS_VOID) out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  // Event handlers, quoted or not.
  out = out.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Script-capable URLs in any attribute.
  out = out.replace(/(\s(?:href|src|action|formaction|xlink:href|background|poster|srcset|data)\s*=\s*)(["']?)\s*(?:javascript|vbscript|livescript)\s*:[^"'\s>]*\2/gi, "$1$2#$2");
  out = out.replace(/(\shref\s*=\s*)(["']?)\s*data\s*:[^"'\s>]*\2/gi, "$1$2#$2");
  // CSS expressions and url(javascript:...) in inline styles.
  out = out.replace(/expression\s*\(/gi, "blocked(").replace(/url\s*\(\s*(["']?)\s*javascript:/gi, "url($1blocked:");
  if (!opts.allowRemoteImages) {
    // Remote images and backgrounds stay unloaded until the reader asks.
    out = out.replace(/(<img\b[^>]*?\s)src(\s*=\s*["']?\s*(?:https?:)?\/\/)/gi, "$1data-blocked-src$2");
    out = out.replace(/(<img\b[^>]*?\s)srcset(\s*=)/gi, "$1data-blocked-srcset$2");
    out = out.replace(/(\s)background(\s*=\s*["']?\s*(?:https?:)?\/\/)/gi, "$1data-blocked-background$2");
    out = out.replace(/url\s*\(\s*(["']?)\s*(?:https?:)?\/\//gi, "url($1blocked://");
  }
  return out;
}

/** True when the message references remote images the reader has not loaded. */
export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\ssrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) || /url\s*\(\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

/** The full document for <iframe srcDoc>, with a CSP that blocks scripts and,
 *  unless allowed, every remote load. Links open in a new tab. */
export function emailSrcDoc(html: string, opts: SanitizeOptions = {}): string {
  const img = opts.allowRemoteImages ? "data: https:" : "data:";
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'`;
  const clean = sanitizeEmailHtml(html, opts);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><meta name="referrer" content="no-referrer">` +
    `<style>html,body{margin:0;padding:0;background:#ffffff;color:#1a1a1f;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere}body{padding:12px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>` +
    `</head><body>${clean}</body></html>`;
}
