import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { resolveConvexUrl } from "@/lib/convex-url";
import { refuseCrossSiteWrite } from "@/lib/api-write-guard";

/* GET  /api/agency/email/inboxes   list inboxes (with unread counts)
   POST /api/agency/email/inboxes   create one: { "localPart": "bookings", "displayName": "Bookings" }
                                     ("address": "bookings@studiopulse.tech" also accepted)

   Auth is the caller's own Clerk session (browser cookie, or
   `Authorization: Bearer <Clerk session token>`). The route mints the user's
   Convex token and calls the same Convex functions the Email tab uses, so the
   owner/admin and mail-agency checks live in one place (convex/mail.ts).
   POST needs Content-Type: application/json, and an Origin of this app or,
   for a script, a Bearer token (lib/api-write-guard.ts).
   Usage: docs/EMAIL-INBOXES.md */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function convexForCaller(): Promise<ConvexHttpClient | Response> {
  const url = resolveConvexUrl();
  if (!url) return json(503, { error: "Convex is not configured" });
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch {
    // Demo mode (no Clerk keys): there is no one to authorize.
    return json(503, { error: "Sign-in is not configured" });
  }
  const { userId, getToken } = session;
  if (!userId) return json(401, { error: "Sign in required" });
  const token = await getToken({ template: "convex" }).catch(() => null);
  if (!token) return json(401, { error: "Sign in required" });
  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  return client;
}

function failure(err: unknown): Response {
  if (err instanceof ConvexError) {
    const d = err.data as { code?: string; message?: string } | string;
    if (typeof d === "object" && d?.code === "FORBIDDEN") return json(403, { error: d.message ?? "Forbidden" });
    const message = typeof d === "string" ? d : d?.message ?? "Request refused";
    return json(/already exists/i.test(message) ? 409 : 400, { error: message });
  }
  return json(500, { error: "Something went wrong" });
}

export async function GET() {
  const client = await convexForCaller();
  if (client instanceof Response) return client;
  try {
    const data = await client.query(api.mail.listMailboxes, {});
    if (!data) return json(403, { error: "Only owners and admins of the agency that owns studiopulse.tech can use Email" });
    return json(200, {
      inboxes: data.mailboxes.map((m) => ({ id: m._id, address: m.address, displayName: m.displayName, fromName: m.fromName, kind: m.kind, active: m.active, unread: m.unread })),
      unroutedUnread: data.unroutedUnread,
    });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: Request) {
  // Cookie-authenticated write: JSON only, and only from this app (or a script
  // carrying its own Bearer token), so another site cannot create inboxes.
  const refused = refuseCrossSiteWrite(req);
  if (refused) return refused;
  const client = await convexForCaller();
  if (client instanceof Response) return client;
  let body: { localPart?: unknown; address?: unknown; displayName?: unknown; fromName?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 2048) return json(413, { error: "Body too large" });
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Send JSON: {\"localPart\": \"bookings\", \"displayName\": \"Bookings\"}" });
  }
  const localPart = typeof body.localPart === "string" ? body.localPart : typeof body.address === "string" ? body.address : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  if (!localPart || !displayName) return json(400, { error: "localPart (or address) and displayName are required" });
  try {
    const out = await client.mutation(api.mail.createMailbox, {
      localPart, displayName, ...(typeof body.fromName === "string" ? { fromName: body.fromName } : {}),
    });
    return json(201, { id: out.id, address: out.address, displayName: out.displayName });
  } catch (err) {
    return failure(err);
  }
}
