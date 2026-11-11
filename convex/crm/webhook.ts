import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { verifySignature } from "../outreach/zuops";

/* POST /zu/events  (design addendum D3: a signal, not a sync)

   Zuops posts lead, appointment, message, call and deal events here, signed with
   HMAC-SHA256 over the raw body (`X-Webhook-Signature: sha256=<hex>`, or the older
   `X-Zuops-Signature`). A valid delivery stores one `crmPulses` row: the event
   name and up to four ids. Nothing else from the body is kept, so a forged or
   replayed body cannot plant data, and no name, phone, email or message text ever
   lands in Convex. Open CRM screens watch `crm.signal` and re-read Zuops live.
   This route only records; it never calls Zuops and never sends anything.
   Off (503) until ZUOPS_CRM_WEBHOOK_SECRET is set. */

export const CRM_EVENTS: ReadonlySet<string> = new Set([
  "lead.created",
  "lead.updated",
  "lead.qualified",
  "appointment.booked",
  "appointment.rescheduled",
  "appointment.cancelled",
  "message.received",
  "message.sent",
  "message.failed",
  "call.completed",
  "deal.updated",
]);

export type SignalKind = "lead" | "booking" | "message" | "call" | "deal";

export function signalKind(event: string): SignalKind | null {
  const prefix = event.split(".")[0];
  if (prefix === "lead") return "lead";
  if (prefix === "appointment") return "booking";
  if (prefix === "message") return "message";
  if (prefix === "call") return "call";
  if (prefix === "deal") return "deal";
  return null;
}

const BODY_MAX_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DELIVERY = /^[A-Za-z0-9_.:-]{1,128}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : {});
const id = (x: unknown): string | undefined => (typeof x === "string" && ID.test(x) ? x : undefined);

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only ids, each checked against a strict pattern. Nothing else is read from the body. */
export function pickIds(event: string, body: unknown): { leadId?: string; bookingId?: string; messageId?: string; callId?: string } {
  const top = rec(body);
  const data = rec(top.data);
  const leadId =
    id(top.lead_id) ??
    id(data.lead_id) ??
    (event.startsWith("lead.") || event === "deal.updated" ? id(rec(data.lead).id) ?? id(data.id) : undefined);
  const out: { leadId?: string; bookingId?: string; messageId?: string; callId?: string } = {};
  if (leadId) out.leadId = leadId;
  const bookingId = id(top.booking_id) ?? id(data.booking_id);
  if (bookingId) out.bookingId = bookingId;
  const messageId = id(top.message_id) ?? id(data.message_id);
  if (messageId) out.messageId = messageId;
  const callId = id(top.call_id) ?? id(data.call_id);
  if (callId) out.callId = callId;
  return out;
}

export const zuEvents = httpAction(async (ctx, req) => {
  const secret = process.env.ZUOPS_CRM_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "Not enabled" });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return json(413, { error: "Body too large" });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > BODY_MAX_BYTES) return json(413, { error: "Body too large" });

  const signature = req.headers.get("x-webhook-signature") ?? req.headers.get("x-zuops-signature");
  if (!(await verifySignature(raw, signature, secret))) return json(401, { error: "Bad signature" });

  const event = req.headers.get("x-webhook-event") ?? req.headers.get("x-zuops-event") ?? "";
  if (!CRM_EVENTS.has(event)) return json(200, { ok: true, ignored: event ? event.slice(0, 64) : "unknown" });

  let body: unknown = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* signed but not JSON: keep the event, no ids */
  }

  const pinned = process.env.ZUOPS_CRM_WORKSPACE_ID?.trim();
  if (pinned) {
    const w = rec(body).workspace_id ?? rec(rec(body).data).workspace_id;
    if (typeof w === "string" && w !== pinned) return json(200, { ok: true, ignored: "workspace" });
  }

  const header = req.headers.get("x-webhook-delivery");
  const deliveryId = header && DELIVERY.test(header) ? header : await sha256Hex(raw);

  const result = await ctx.runMutation(internal.crm._pulse, { event, deliveryId, ...pickIds(event, body) });
  if (result === "no_agency") return json(503, { error: "Not set up" });
  if (result === "duplicate") return json(200, { ok: true, duplicate: true });
  if (result === "invalid") return json(400, { error: "Bad delivery" });
  return json(202, { ok: true });
});
