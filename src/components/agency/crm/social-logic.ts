/* Instagram and Messenger: response shapes and the pure logic behind the Social
   panel, unit tested in social-logic.test.ts. Shapes come from the examples in
   the Zuops OpenAPI spec; everything is optional or nullable. */

import type { Iso } from "./zu-types";
import type { ZuError } from "./zu-store";

export type SocialAccount = {
  id: string;
  platform?: "instagram" | "messenger" | "facebook" | string | null;
  name?: string | null;
  page_name?: string | null;
  username?: string | null;
  enabled?: boolean | null;
  ai_replies?: boolean | null;
  status?: "connected" | "needs_reconnect" | "error" | string | null;
  live?: boolean | null;
  last_error?: string | null;
  last_event_at?: Iso | null;
  connected_at?: Iso | null;
};
export type SocialAccountsResponse = { accounts?: SocialAccount[] };

export type LeadMode = "qualified" | "everyone";
export type SocialSettings = { lead_mode?: LeadMode | string | null; dm_leads_to_move?: number | null };

export type SocialComment = {
  id: string;
  platform?: string | null;
  account?: { id?: string; name?: string | null } | null;
  post_id?: string | null;
  commenter?: { id?: string; name?: string | null } | null;
  text?: string | null;
  rule?: { id?: string; name?: string | null } | null;
  public_reply?: boolean | null;
  dm_status?: "sent" | "failed" | "skipped" | string | null;
  error?: string | null;
  lead_id?: string | null;
  created_at?: Iso | null;
};
export type CommentCounts = { all?: number | null; sent?: number | null; failed?: number | null; skipped?: number | null };
export type SocialCommentsResponse = { comments?: SocialComment[]; counts?: CommentCounts | null; has_more?: boolean; next_offset?: number | null };

export type SocialMessage = {
  id: string;
  lead_id?: string | null;
  channel?: string | null;
  direction?: "inbound" | "outbound" | string | null;
  body?: string | null;
  media_urls?: string[] | null;
  social?: { account_id?: string | null; sent_by?: string | null } | null;
  created_at?: Iso | null;
  lead?: { id?: string; full_name?: string | null } | null;
};
export type MessagesResponse = { messages?: SocialMessage[]; has_more?: boolean };

export type MoveDmLeadsResponse = { would_move?: number | null; moved?: number | null };

export const SOCIAL_OFF_REASON = "Instagram and Messenger is off for this account. Turn it on in Zuops, Settings, Instagram & Messenger.";

/** Zuops answers 403 `not_enabled` when Instagram & Messenger is off. */
export function isNotEnabled(error: ZuError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "not_enabled") return true;
  return error.status === 403 && /not[ _]enabled|is off for this account/i.test(error.reason);
}

export function platformWord(p: string | null | undefined): string {
  if (p === "instagram") return "Instagram";
  if (p === "messenger" || p === "facebook") return "Messenger";
  return p ? p[0].toUpperCase() + p.slice(1) : "Account";
}

export type Tone = "positive" | "caution" | "critical" | "neutral" | "info";

export function connectionStatus(a: Pick<SocialAccount, "status" | "live">): { word: string; tone: Tone; ok: boolean } {
  switch (a.status) {
    case "connected": return a.live === false ? { word: "Connected, not live", tone: "caution", ok: false } : { word: "Connected", tone: "positive", ok: true };
    case "needs_reconnect": return { word: "Needs reconnect", tone: "caution", ok: false };
    case "error": return { word: "Error", tone: "critical", ok: false };
    default: return { word: a.status ? a.status.replace(/_/g, " ") : "Unknown", tone: "neutral", ok: false };
  }
}

export function dmStatus(s: string | null | undefined): { word: string; tone: Tone } {
  switch (s) {
    case "sent": return { word: "DM sent", tone: "positive" };
    case "failed": return { word: "DM failed", tone: "critical" };
    case "skipped": return { word: "DM skipped (already sent)", tone: "neutral" };
    default: return { word: s ? `DM ${s}` : "No DM", tone: "neutral" };
  }
}

export const LEAD_MODES: ReadonlyArray<{ id: LeadMode; label: string; explain: string }> = [
  {
    id: "qualified",
    label: "Qualified only (recommended)",
    explain: "Someone who only sends a DM stays a conversation in Messages, not a lead, until they share a phone number or email, book, or someone adds them to Leads.",
  },
  {
    id: "everyone",
    label: "Everyone who sends a DM",
    explain: "Every new DM person becomes a lead right away. That starts your new-lead automations, webhooks and field-service push for each of them.",
  },
];

export type CommentFilters = {
  status: "all" | "sent" | "failed" | "skipped";
  account: string;
  search: string;
  from: string;
  to: string;
  oldestFirst: boolean;
};

export const EMPTY_COMMENT_FILTERS: CommentFilters = { status: "all", account: "all", search: "", from: "", to: "", oldestFirst: false };
export const COMMENTS_PAGE = 25;

/** Query for GET /v1/social/comments. Dates are whole days: `to` covers its day. */
export function commentsQuery(f: CommentFilters, offset: number): Record<string, string | number | boolean | undefined> {
  const search = f.search.trim().slice(0, 100);
  return {
    limit: COMMENTS_PAGE,
    offset: offset > 0 ? offset : undefined,
    status: f.status !== "all" ? f.status : undefined,
    account_id: f.account !== "all" ? f.account : undefined,
    search: search || undefined,
    from: f.from || undefined,
    to: f.to ? `${f.to}T23:59:59Z` : undefined,
    oldest_first: f.oldestFirst ? true : undefined,
  };
}

/** "3 people would move back to Messages". */
export function moveCountText(n: number): string {
  return n === 0 ? "Nobody needs to move."
    : `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} would move back to Messages`;
}

export const COUNT_MISSING = "Zuops did not return a count. Try again.";

/** A count field from move_dm_leads: `would_move` (apply false) or `moved`
 *  (apply true). Only a whole number of zero or more counts; anything else is
 *  missing, never zero (R3-I5). */
export function readMoveCount(data: MoveDmLeadsResponse | null | undefined, field: "would_move" | "moved"): number | null {
  const v = data?.[field];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

export type CountOutcome = { kind: "missing"; text: string } | { kind: "none"; text: string } | { kind: "some"; n: number; text: string };

export function countOutcome(n: number | null): CountOutcome {
  if (n === null) return { kind: "missing", text: COUNT_MISSING };
  if (n === 0) return { kind: "none", text: moveCountText(0) };
  return { kind: "some", n, text: moveCountText(n) };
}

/** The newest first, Instagram and Messenger together. */
export function mergeDms(a: SocialMessage[], b: SocialMessage[]): SocialMessage[] {
  const t = (m: SocialMessage) => (m.created_at ? Date.parse(m.created_at) || 0 : 0);
  return [...a, ...b].sort((x, y) => t(y) - t(x));
}
