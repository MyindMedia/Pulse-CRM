import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { verifySignature } from "./zuops";

/* POST /zuops/events
   Zuops posts appointment.booked / appointment.cancelled here, signed with
   HMAC-SHA256 over the raw body (X-Zuops-Signature: sha256=<hex>). The body is not
   trusted for content: a valid delivery only triggers the same read-only sync the
   cron runs, pinned to the workspace an operator mapped. Off until
   ZUOPS_WEBHOOK_SECRET is set. */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const EVENTS = new Set(["appointment.booked", "appointment.cancelled"]);

export const zuopsEvents = httpAction(async (ctx, req) => {
  const secret = process.env.ZUOPS_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "Not enabled" });
  const raw = await req.text();
  if (raw.length > 128 * 1024) return json(413, { error: "Body too large" });
  if (!(await verifySignature(raw, req.headers.get("x-zuops-signature"), secret))) return json(401, { error: "Bad signature" });
  const event = req.headers.get("x-zuops-event") ?? "";
  if (!EVENTS.has(event)) return json(200, { ok: true, ignored: event || "unknown" });
  let workspaceId: string | undefined;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const w = body.workspace_id ?? (body.data as Record<string, unknown> | undefined)?.workspace_id;
    if (typeof w === "string") workspaceId = w;
  } catch { /* the signature was valid; sync everything mapped */ }
  await ctx.scheduler.runAfter(0, internal.outreachZuops.syncAll, { workspaceId });
  return json(202, { ok: true });
});
