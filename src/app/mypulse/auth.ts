import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/* The /mypulse gate.
 *
 * A shared password, not an account: this is one link handed to the sales
 * team, and every rep uses the same one. The cookie stores a hash of the
 * password rather than the password, so a stolen cookie is worth no more
 * than the link it came from, and the page content is rendered server-side
 * only after the check - a locked visitor's HTML holds no features.
 *
 * Override in Netlify with MYPULSE_PASSWORD to rotate it without a deploy. */

const PASSWORD = process.env.MYPULSE_PASSWORD || "mypulse255!";

export const MYPULSE_COOKIE = "mypulse_access";
export const MYPULSE_PATH = "/mypulse";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The cookie value a cleared visitor carries. Derived, never stored. */
export function accessToken(): string {
  return sha(`mypulse.v1.${PASSWORD}`);
}

/** Constant-time compare so the form cannot be probed character by character. */
export function checkPassword(input: string): boolean {
  const a = Buffer.from(sha(input));
  const b = Buffer.from(sha(PASSWORD));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isUnlocked(): Promise<boolean> {
  const jar = await cookies();
  const got = jar.get(MYPULSE_COOKIE)?.value;
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(accessToken());
  return a.length === b.length && timingSafeEqual(a, b);
}
