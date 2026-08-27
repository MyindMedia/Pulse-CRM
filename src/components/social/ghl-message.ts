import type { Platform } from "@convex/lib/ghl";

/** The shape of GHL's postMessage payload when its OAuth popup finishes. */
export type GhlCloseMessage = {
  actionType?: string;
  page?: string;
  platform?: string;
  accountId?: string;
};

/**
 * True when `data` is GHL's own "connection closed" signal for `platform`:
 * the right actionType and page, and an accountId to act on.
 *
 * `platform` on the message is optional and, when present but different from
 * this button's own, rejected - ten ConnectButton instances share the global
 * `message` event and each must ignore the other nine's popups. A message
 * that omits `platform` entirely is accepted rather than rejected: nothing in
 * this codebase has verified GHL always sends one, so treating an absent
 * field as "unclear" rather than "mismatched" is the safer read of an
 * external contract nobody here controls. This function documents that
 * choice; only the live GHL integration can settle whether it is right.
 */
export function isOwnGhlCloseMessage(
  data: unknown,
  platform: Platform,
): data is GhlCloseMessage & { accountId: string } {
  if (!data || typeof data !== "object") return false;
  const d = data as GhlCloseMessage;
  if (d.actionType !== "close" || d.page !== "social-media-posting" || !d.accountId) return false;
  if (d.platform && d.platform !== platform) return false;
  return true;
}
