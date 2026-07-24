import { NextResponse } from "next/server";
import { z } from "zod";
import {
  resendConfigured,
  sendNewsletterBatch,
  sendNewsletterBroadcast,
} from "@/lib/email";

/*
 * POST /api/admin/newsletter
 *
 * Fire one newsletter issue to Pulse's owned-channel audience without a human
 * in Resend's dashboard. Gated by ADMIN_SECRET (server-to-server / agent), NOT
 * Clerk - middleware.ts exempts this path from the sign-in redirect so the
 * ADMIN_SECRET header is the only gate.
 *
 *   Authorization: Bearer <ADMIN_SECRET>   (or  x-admin-secret: <ADMIN_SECRET>)
 *   Content-Type: application/json
 *   {
 *     "subject": "Pulse Newsletter #1 - ...",
 *     "html":    "<h1>...</h1>",
 *     "mode":    "broadcast" | "batch",     // default "broadcast"
 *     "recipients": ["a@b.com", ...],        // required for "batch"
 *     "audienceId": "...",                   // optional override (broadcast)
 *     "from":    "Pulse <news@myindsound.com>", // optional
 *     "replyTo": "hi@myindsound.com",        // optional
 *     "name":    "Issue #1"                   // optional broadcast label
 *   }
 *
 * Env: ADMIN_SECRET (gate), RESEND_API_KEY (send), RESEND_AUDIENCE_ID
 * (broadcast list), RESEND_FROM (default sender). With RESEND_API_KEY unset the
 * send no-ops to "simulated" so agents can dry-run the path safely.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  subject: z.string().trim().min(1, "subject is required").max(200),
  html: z.string().trim().min(1, "html is required"),
  mode: z.enum(["broadcast", "batch"]).default("broadcast"),
  recipients: z.array(z.email()).optional(),
  audienceId: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  replyTo: z.email().optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

/** Constant-time-ish secret compare (avoids trivial length/early-exit leaks). */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return { ok: false, status: 503, error: "ADMIN_SECRET not configured on the server" };

  const header = req.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const provided = bearer ?? req.headers.get("x-admin-secret")?.trim() ?? "";
  if (!provided || !secretMatches(provided, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.mode === "batch") {
    if (!body.recipients || body.recipients.length === 0) {
      return NextResponse.json(
        { ok: false, error: "batch mode requires a non-empty recipients[] array" },
        { status: 400 },
      );
    }
    const result = await sendNewsletterBatch({
      recipients: body.recipients,
      subject: body.subject,
      html: body.html,
      from: body.from,
      replyTo: body.replyTo,
    });
    const httpStatus = result.status === "failed" ? 502 : 200;
    return NextResponse.json({ ok: result.status !== "failed", mode: "batch", ...result }, { status: httpStatus });
  }

  // Default: broadcast to the managed Resend Audience (the "full waitlist").
  const result = await sendNewsletterBroadcast({
    subject: body.subject,
    html: body.html,
    audienceId: body.audienceId,
    from: body.from,
    replyTo: body.replyTo,
    name: body.name,
  });
  const httpStatus = result.status === "failed" ? 502 : 200;
  return NextResponse.json({ ok: result.status !== "failed", mode: "broadcast", ...result }, { status: httpStatus });
}

/** Lightweight readiness probe (still ADMIN_SECRET-gated) - reports which env
 *  pieces are wired so an operator can confirm before firing Issue #1. */
export async function GET(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  return NextResponse.json({
    ok: true,
    ready: {
      resendApiKey: resendConfigured(),
      audienceId: Boolean(process.env.RESEND_AUDIENCE_ID),
      from: process.env.RESEND_FROM ?? "Pulse <support@myindsound.com>",
    },
  });
}
