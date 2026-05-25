import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { exchangeCode, emailFromIdToken } from "./lib/google";

const http = httpRouter();

/* Google OAuth callback — exchanges the code, stores the studio's refresh token
   (state carries the orgId), then bounces back to the app settings. */
http.route({
  path: "/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const orgId = url.searchParams.get("state");
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    if (!code || !orgId) {
      return Response.redirect(`${appUrl}/settings?google=error`, 302);
    }
    try {
      const tokens = await exchangeCode(code);
      if (tokens.refresh_token) {
        await ctx.runMutation(internal.googleAuth._storeTokens, {
          orgId,
          refreshToken: tokens.refresh_token,
          email: emailFromIdToken(tokens.id_token) ?? undefined,
        });
      }
      return Response.redirect(`${appUrl}/settings?google=connected`, 302);
    } catch {
      return Response.redirect(`${appUrl}/settings?google=error`, 302);
    }
  }),
});

/* Stripe webhook receiver - verifies signature, dispatches to
   internal mutation, returns 200 on success. Idempotent inside. */
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const body = await req.text();
    if (!sig || !secret) return new Response("missing signature", { status: 400 });
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(body, sig, secret);
    } catch (e) {
      return new Response(`invalid signature: ${(e as Error).message}`, { status: 400 });
    }
    await ctx.runMutation(internal.billingWebhooks.handle, {
      event: { id: event.id, type: event.type, data: event.data },
    });
    return new Response("ok", { status: 200 });
  }),
});

/* Inbound SMS receiver - handles client replies + STOP/START opt-outs. Accepts
   Twilio's form-encoded payload (From/Body) or Telnyx's JSON. Returns empty
   TwiML so Twilio doesn't auto-reply. */
http.route({
  path: "/sms/inbound",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let from = "";
    let body = "";
    const contentType = req.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        const json = (await req.json()) as {
          data?: { payload?: { from?: { phone_number?: string }; text?: string } };
        };
        from = json.data?.payload?.from?.phone_number ?? "";
        body = json.data?.payload?.text ?? "";
      } else {
        const form = new URLSearchParams(await req.text());
        from = form.get("From") ?? "";
        body = form.get("Body") ?? "";
      }
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (from) await ctx.runMutation(internal.sms._handleInbound, { from, body });
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }),
});

export default http;
