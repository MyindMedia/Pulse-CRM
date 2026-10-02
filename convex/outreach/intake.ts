import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

/* POST /outreach/intake
   Secured drop point for the iPhone Share Sheet shortcut and the local
   Instaloader helper. Off unless both OUTREACH_INTAKE_SECRET and
   OUTREACH_INTAKE_AGENCY_ID are set on the deployment. The agency comes from
   that server setting, so a caller can never choose a tenant. */

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const intake = httpAction(async (ctx, req) => {
  const secret = process.env.OUTREACH_INTAKE_SECRET;
  const agencyId = process.env.OUTREACH_INTAKE_AGENCY_ID;
  if (!secret || !agencyId) return json(503, { error: "Intake is not enabled" });
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return json(401, { error: "Unauthorized" });
  const raw = await req.text();
  if (raw.length > 4096) return json(413, { error: "Body too large" });
  let body: { url?: unknown; handle?: unknown; website?: unknown; name?: unknown; source?: unknown };
  try { body = JSON.parse(raw); } catch { return json(400, { error: "Invalid JSON" }); }
  const line = typeof body.url === "string" ? body.url : typeof body.handle === "string" ? body.handle : "";
  if (!line) return json(400, { error: "Send url or handle" });
  const out = await ctx.runMutation(internal.outreachProspects.intakeProspect, {
    agencyId,
    line: line.slice(0, 300),
    website: typeof body.website === "string" ? body.website.slice(0, 300) : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    source: body.source === "instaloader" ? "instaloader" : "shortcut",
  });
  return json(out.result === "invalid" ? 422 : 200, out);
});
