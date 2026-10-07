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
 * The password lives ONLY in the MYPULSE_PASSWORD environment variable
 * (Netlify). There is no fallback in the repo: when the variable is unset or
 * empty the gate FAILS CLOSED, so no password opens it and no cookie is
 * accepted. Read per call, so rotating it in Netlify takes effect on the next
 * deploy without a code change. */

export const MYPULSE_COOKIE = "mypulse_access";
export const MYPULSE_PATH = "/mypulse";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The configured password, or null when none is set (gate closed). */
function configuredPassword(): string | null {
  const p = process.env.MYPULSE_PASSWORD;
  return p && p.trim().length > 0 ? p : null;
}

/** True when the gate can be opened at all. */
export function gateConfigured(): boolean {
  return configuredPassword() !== null;
}

/** The cookie value a cleared visitor carries. Derived, never stored. Null
 *  when the gate is closed, so no cookie can ever match. */
export function accessToken(): string | null {
  const p = configuredPassword();
  return p === null ? null : sha(`mypulse.v1.${p}`);
}

/** Constant-time compare so the form cannot be probed character by character.
 *  Always false when no password is configured. */
export function checkPassword(input: string): boolean {
  const p = configuredPassword();
  if (p === null) return false;
  const a = Buffer.from(sha(input));
  const b = Buffer.from(sha(p));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isUnlocked(): Promise<boolean> {
  const expected = accessToken();
  if (expected === null) return false;
  const jar = await cookies();
  const got = jar.get(MYPULSE_COOKIE)?.value;
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
