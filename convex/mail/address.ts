/* Mailbox addresses: validation for new inboxes, normalisation, and routing an
   inbound message to a mailbox by its recipients. Pure, no database. */

export const MAIL_DOMAIN = "studiopulse.tech";

/** Names a new inbox may not take: role addresses with a meaning (RFC 2142),
 *  addresses that look like system or security mail, and the sending subdomain. */
export const RESERVED_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "postmaster", "abuse", "hostmaster", "webmaster", "security", "noc", "root", "admin",
  "administrator", "mailer-daemon", "mailerdaemon", "daemon", "nobody", "noreply", "no-reply",
  "donotreply", "do-not-reply", "bounce", "bounces", "dmarc", "dkim", "spf", "ssl", "www",
  "ftp", "mail", "email", "send", "resend", "list", "list-request", "unsubscribe", "billing-noreply",
]);

export type LocalPartCheck = { ok: true; localPart: string; address: string } | { ok: false; error: string };

/** Validates the part before the @ for a new inbox. Lowercase a-z, 0-9, dot,
 *  underscore and hyphen; 1 to 64 characters; starts and ends with a letter or
 *  digit; no two dots in a row; not reserved. */
export function checkLocalPart(input: string): LocalPartCheck {
  const raw = input.trim();
  const at = raw.indexOf("@");
  if (at >= 0) {
    const domain = raw.slice(at + 1).toLowerCase();
    if (domain !== MAIL_DOMAIN) return { ok: false, error: `Only @${MAIL_DOMAIN} addresses can be inboxes.` };
  }
  const local = at >= 0 ? raw.slice(0, at) : raw;
  if (!local) return { ok: false, error: "Enter the part before the @." };
  if (local !== local.toLowerCase()) return { ok: false, error: "Use lowercase letters only." };
  if (local.length > 64) return { ok: false, error: "That name is too long (64 characters at most)." };
  if (!/^[a-z0-9._-]+$/.test(local)) return { ok: false, error: "Use only a-z, 0-9, dot, underscore and hyphen." };
  if (!/^[a-z0-9]/.test(local) || !/[a-z0-9]$/.test(local)) return { ok: false, error: "Start and end with a letter or a number." };
  if (local.includes("..")) return { ok: false, error: "Two dots in a row are not allowed." };
  if (RESERVED_LOCAL_PARTS.has(local)) return { ok: false, error: `${local}@ is reserved and cannot be an inbox.` };
  return { ok: true, localPart: local, address: `${local}@${MAIL_DOMAIN}` };
}

export function checkDisplayName(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, error: "Give the inbox a display name." };
  if (value.length > 60) return { ok: false, error: "Keep the display name under 60 characters." };
  return { ok: true, value };
}

/** Pulls the bare address out of `Name <a@b>` or `a@b`, lowercased. Null when there is none. */
export function bareAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(value);
  const candidate = (angle ? angle[1] : value).trim().replace(/^mailto:/i, "");
  const m = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.exec(candidate);
  return m ? candidate.toLowerCase() : null;
}

/** Display name from `Name <a@b>`, or null. */
export function displayNameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(value);
  const name = m?.[1]?.trim();
  return name ? name : null;
}

/** A recipient address in our domain, with any `+tag` removed. */
export function ownAddress(value: string): string | null {
  const addr = bareAddress(value);
  if (!addr) return null;
  const [local, domain] = addr.split("@");
  if (domain !== MAIL_DOMAIN) return null;
  const base = local.split("+")[0];
  return base ? `${base}@${domain}` : null;
}

/** A plausible outbound recipient. Not RFC 5322 complete, on purpose. */
export function isSendableAddress(value: string): boolean {
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(value.trim()) && value.trim().length <= 254;
}

/** Which of our addresses an inbound message was for, best signal first:
 *  the envelope recipients (received_for, covers Bcc), then To, then Cc. */
export function routeRecipients(
  msg: { receivedFor?: string[]; to?: string[]; cc?: string[] },
  activeAddresses: ReadonlySet<string>,
): { address: string | null; candidates: string[] } {
  const ordered = [...(msg.receivedFor ?? []), ...(msg.to ?? []), ...(msg.cc ?? [])];
  const candidates: string[] = [];
  for (const r of ordered) {
    const a = ownAddress(r);
    if (a && !candidates.includes(a)) candidates.push(a);
  }
  const hit = candidates.find((a) => activeAddresses.has(a)) ?? null;
  return { address: hit, candidates };
}

/** Role addresses a certificate authority, registrar or abuse desk writes to
 *  (CA/B Forum domain validation uses admin, administrator, webmaster,
 *  hostmaster and postmaster). Mail to them can prove control of the domain,
 *  so it is quarantined rather than shown in Unrouted to every admin. */
export const QUARANTINED_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "admin", "administrator", "postmaster", "hostmaster", "webmaster", "abuse",
]);

/** The first of our recipient addresses that is a quarantined role address, or null. */
export function quarantinedRecipient(candidates: readonly string[]): string | null {
  for (const a of candidates) {
    const local = a.slice(0, a.indexOf("@")).toLowerCase();
    if (QUARANTINED_LOCAL_PARTS.has(local)) return a;
  }
  return null;
}
