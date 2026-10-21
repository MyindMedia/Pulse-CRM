/* Zuops as the SMS provider (SMS_PROVIDER=zuops). Texts go out from the Pulse
   sub-account's default number, which carries its own approved A2P
   registration. Zuops can only message a lead, so each send finds or creates
   the recipient as a lead first (tagged pulse-sms, never run through intake,
   so Zuops does not greet them or start its AI on them), then sends to it.

   Replies come back by polling GET /v1/messages with a cursor (sms.ts,
   _pollZuopsInbound): the Pulse key is pinned to one sub-account and cannot
   register a webhook.

   Env: ZUOPS_SMS_API_KEY (scopes leads:read/write, messaging:read/write) and
   ZUOPS_SMS_WORKSPACE_ID. Kept apart from ZUOPS_API_KEY, the read-only key
   the demo-booking sync uses. Missing either one = "simulated". */

import type { SmsStatus } from "./sms";

const ZUOPS_BASE = "https://api.zuops.com/functions/v1/api-gateway";
export const ZUOPS_SMS_TAG = "pulse-sms";

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x.trim() : undefined);

export function zuopsSmsConfig(): { key: string; workspaceId: string } | null {
  const key = process.env.ZUOPS_SMS_API_KEY;
  const workspaceId = process.env.ZUOPS_SMS_WORKSPACE_ID;
  return key && workspaceId ? { key, workspaceId } : null;
}

function headers(key: string) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" };
}

/** The lead id for a phone: a new lead, or the existing one Zuops matched (409). */
async function leadIdFor(to: string, cfg: { key: string; workspaceId: string }, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(`${ZUOPS_BASE}/v1/leads`, {
    method: "POST",
    headers: headers(cfg.key),
    body: JSON.stringify({ workspace_id: cfg.workspaceId, phone: to, tags: [ZUOPS_SMS_TAG], run_intake: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = rec(await res.json().catch(() => ({})));
  if (res.status === 201 || res.status === 200) return str(rec(rec(json.data).lead).id) ?? null;
  if (res.status === 409) return str(rec(json.details).lead_id) ?? null;
  return null;
}

export async function sendZuopsSms({ to, body }: { to: string; body: string }, fetchImpl: typeof fetch = fetch): Promise<SmsStatus> {
  const cfg = zuopsSmsConfig();
  if (!cfg) return "simulated";
  try {
    const leadId = await leadIdFor(to, cfg, fetchImpl);
    if (!leadId) return "failed";
    const res = await fetchImpl(`${ZUOPS_BASE}/v1/messages`, {
      method: "POST",
      headers: headers(cfg.key),
      body: JSON.stringify({ lead_id: leadId, channel: "sms", body, actor_label: "Pulse" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return "failed";
    const json = rec(await res.json().catch(() => ({})));
    return json.success === false ? "failed" : "sent";
  } catch {
    return "failed";
  }
}

export type ZuopsInbound = { id: string; from: string; body: string };

/** One page of inbound texts after `cursor` (or after `since` on the first
 *  run), oldest first. `next` is where the following call resumes. */
export async function fetchZuopsInbound(
  start: { cursor: string } | { since: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; messages: ZuopsInbound[]; next: string | null; more: boolean } | { ok: false; reason: string }> {
  const cfg = zuopsSmsConfig();
  if (!cfg) return { ok: false, reason: "Zuops SMS is not configured." };
  const qs = new URLSearchParams({ workspace_id: cfg.workspaceId, channel: "sms", direction: "inbound", limit: "100" });
  if ("cursor" in start) qs.set("cursor", start.cursor);
  else qs.set("since", start.since);
  try {
    const res = await fetchImpl(`${ZUOPS_BASE}/v1/messages?${qs}`, {
      headers: headers(cfg.key),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, reason: `Zuops answered ${res.status}.` };
    const data = rec(rec(await res.json()).data);
    const rows = Array.isArray(data.messages) ? data.messages : [];
    const messages: ZuopsInbound[] = [];
    for (const r of rows.map(rec)) {
      const id = str(r.id);
      const from = str(r.from) ?? str(rec(r.lead).phone);
      if (!id || !from || r.direction !== "inbound" || r.channel !== "sms") continue;
      messages.push({ id, from, body: typeof r.body === "string" ? r.body : "" });
    }
    return { ok: true, messages, next: str(data.next_cursor) ?? null, more: data.has_more === true };
  } catch {
    return { ok: false, reason: "Could not reach Zuops." };
  }
}

/** The Zuops tag that groups one studio's contacts inside the shared sub-account. */
export function studioTag(studioName: string): string {
  return `Studio: ${studioName.replace(/\s+/g, " ").trim()}`.slice(0, 80);
}

/** Puts a phone's Zuops lead in a studio's group: creates the lead with the
 *  tag (and the client's name), or adds the tag to the lead Zuops already has.
 *  A name is only written onto a lead that has none, so a real sales lead
 *  keeps its own. Never runs intake. */
export async function tagZuopsLead(
  args: { phone: string; tag: string; name?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<"tagged" | "failed" | "off"> {
  const cfg = zuopsSmsConfig();
  if (!cfg) return "off";
  try {
    const create = await fetchImpl(`${ZUOPS_BASE}/v1/leads`, {
      method: "POST",
      headers: headers(cfg.key),
      body: JSON.stringify({
        workspace_id: cfg.workspaceId,
        phone: args.phone,
        tags: [ZUOPS_SMS_TAG, args.tag],
        run_intake: false,
        ...(args.name ? { full_name: args.name } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = rec(await create.json().catch(() => ({})));
    if (create.status === 201 || create.status === 200) return "tagged";
    if (create.status !== 409) return "failed";
    const leadId = str(rec(json.details).lead_id);
    if (!leadId) return "failed";
    let named = true;
    if (args.name) {
      const got = await fetchImpl(`${ZUOPS_BASE}/v1/leads/${encodeURIComponent(leadId)}?workspace_id=${encodeURIComponent(cfg.workspaceId)}`, {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(15_000),
      });
      named = !got.ok || !!str(rec(rec(rec(await got.json().catch(() => ({}))).data).lead).full_name);
    }
    const patch = await fetchImpl(`${ZUOPS_BASE}/v1/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: headers(cfg.key),
      body: JSON.stringify({ add_tags: [ZUOPS_SMS_TAG, args.tag], ...(!named && args.name ? { full_name: args.name } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    return patch.ok ? "tagged" : "failed";
  } catch {
    return "failed";
  }
}
