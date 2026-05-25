/* Brand voice rule: NO em dashes anywhere in outbound copy. This is the egress
   guard applied at every send point (email, SMS/iMessage) and to AI-generated
   text, so nothing the user or a prospect ever sees contains an em dash, even
   when the source is an LLM, an automation, or free-typed input. Em, en, and
   horizontal-bar dashes all collapse to a plain hyphen. */
export function stripEmDashes<T extends string | undefined | null>(value: T): T {
  if (typeof value !== "string") return value;
  return value.replace(/[—–―]/g, "-") as T;
}
