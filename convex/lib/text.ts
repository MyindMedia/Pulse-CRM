/* Brand voice rule: NO em dashes anywhere in outbound copy. This is the egress
   guard applied at every send point (email, SMS/iMessage) and to AI-generated
   text, so nothing the user or a prospect ever sees contains an em dash, even
   when the source is an LLM, an automation, or free-typed input. Em, en, and
   horizontal-bar dashes all collapse to a plain hyphen. */
export function stripEmDashes<T extends string | undefined | null>(value: T): T {
  if (typeof value !== "string") return value;
  return value.replace(/[—–―]/g, "-") as T;
}

/** HTML-escape a string before interpolating it into an email/markup template,
 *  so user/LLM/DB-supplied text can't inject markup. */
export function escapeHtml(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
