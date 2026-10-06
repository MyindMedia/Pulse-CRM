/* Instagram DM drafting. Pure functions, no network, no sending.

   Instagram's official messaging API only lets a business reply to someone who
   messaged first, and tools that log in to send for you break Instagram's terms.
   So Pulse drafts the message, a human approves each one, and the human sends it
   from Instagram. Pulse records that it was sent. */

export const DM_MAX_CHARS = 600;
export const DM_TARGET_CHARS = 330;
/** One DM per studio per 30 days. */
export const DM_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const DM_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type DmInput = {
  handle: string;
  studio?: string;
  bio?: string;
  category?: string;
};

const SERVICES: Array<[RegExp, string]> = [
  [/\bmix(ing)?\b|\bmastering\b/i, "mixing and mastering"],
  [/\bpodcast/i, "podcast recording"],
  [/\brehears/i, "rehearsal space"],
  [/\bbook(ing)?\b/i, "taking bookings"],
  [/\bproduc(er|tion)\b/i, "production"],
  [/\brecord(ing)?\b/i, "recording"],
];

/** One short, true observation drawn from what the studio wrote about itself. */
export function observationFrom(i: Pick<DmInput, "bio" | "category">): string | undefined {
  const bio = (i.bio ?? "").replace(/[\r\n]+/g, " ");
  for (const [re, label] of SERVICES) if (re.test(bio)) return label;
  if (i.category && /studio|production|recording|music/i.test(i.category)) return i.category.toLowerCase();
  return undefined;
}

/** Display name to greet: the studio name, trimmed of city suffixes and noise. */
export function greetingName(i: Pick<DmInput, "handle" | "studio">): string {
  const raw = (i.studio ?? "").replace(/[^\p{L}\p{N}&' .-]/gu, " ").replace(/\s+/g, " ").trim();
  return (raw || i.handle).slice(0, 40);
}

/** The cold-DM copy. No link (cold DMs with links are filtered), no dashes, no
 *  credentials, one question, and a clear way to say no. */
export function draftDm(i: DmInput): { text: string; observation?: string } {
  const observation = observationFrom(i);
  const name = greetingName(i);
  const hook = observation
    ? `came across ${name} and liked that you focus on ${observation}.`
    : `came across ${name} and liked the space you have built.`;
  const text = [
    `Hey, ${hook}`,
    "I run Pulse, a studio app that keeps bookings, sessions and split sheets in one place so nothing slips between sessions.",
    "Open to a quick look? Happy to send a 2 minute walkthrough here. If it is not a fit, say stop and I will not message again.",
  ].join(" ");
  return { text, observation };
}

export function dmBlockers(a: {
  text: string;
  handle?: string | null;
  optedOut: boolean;
  lastSentAt?: number | null;
  now: number;
}): string[] {
  const out: string[] = [];
  if (!a.handle) out.push("This prospect has no Instagram handle.");
  if (a.optedOut) out.push("This account asked not to be contacted.");
  if (a.lastSentAt && a.now - a.lastSentAt < DM_COOLDOWN_MS) {
    const days = Math.ceil((DM_COOLDOWN_MS - (a.now - a.lastSentAt)) / (24 * 60 * 60 * 1000));
    out.push(`A DM went to this studio less than 30 days ago. Wait ${days} more day${days === 1 ? "" : "s"}.`);
  }
  if (!a.text.trim()) out.push("The message is empty.");
  if (a.text.length > DM_MAX_CHARS) out.push(`The message is over ${DM_MAX_CHARS} characters.`);
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|app|to|tech)\b/i.test(a.text)) out.push("Remove links: cold DMs with links get filtered.");
  return out;
}

/** The ig.me deep link that opens the studio's DM thread in Instagram. */
export function dmLink(handle: string): string {
  return `https://ig.me/m/${encodeURIComponent(handle.toLowerCase())}`;
}

/** Suppression key for a DM opt-out, stored in outreachSuppressions.email. */
export function dmSuppressionKey(handle: string): string {
  return `ig:${handle.toLowerCase()}`;
}
