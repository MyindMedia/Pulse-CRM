import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { exchangeCode, emailFromIdToken } from "./lib/google";

const http = httpRouter();

/* Google OAuth callback - exchanges the code, stores the studio's refresh token
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
    // Two endpoints share this URL: the platform endpoint (account events) and
    // the Connect endpoint (events on studios' connected accounts, e.g. deposit
    // checkouts + membership subscriptions). Each has its own signing secret, so
    // we try both. Verify with the async (SubtleCrypto) API for the Convex runtime.
    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    ].filter((s): s is string => Boolean(s));
    const body = await req.text();
    if (!sig || secrets.length === 0) return new Response("missing signature", { status: 400 });
    const stripe = stripeClient();
    let event;
    let lastErr: unknown;
    for (const secret of secrets) {
      try {
        event = await stripe.webhooks.constructEventAsync(body, sig, secret);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!event) {
      return new Response(`invalid signature: ${(lastErr as Error)?.message}`, { status: 400 });
    }
    await ctx.runMutation(internal.billingWebhooks.handle, {
      event: {
        id: event.id,
        type: event.type,
        // Pass the connected-account id through so studio-level (Connect) events
        // are routed differently from platform events.
        account: event.account ?? undefined,
        data: event.data,
      },
    });
    return new Response("ok", { status: 200 });
  }),
});

/* Inbound SMS/iMessage receiver - client replies + STOP/START opt-outs.
   Accepts Twilio (form From/Body), Telnyx (JSON data.payload), and LoopMessage
   (JSON {event, contact, text}). LoopMessage also posts outbound status events
   (message_sent/failed/...) here - we ack those without processing. Returns 200
   (empty TwiML) so providers don't auto-retry or auto-reply. */
http.route({
  path: "/sms/inbound",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // LoopMessage: verify the configurable webhook authorization header.
    const loopSecret = process.env.LOOPMESSAGE_WEBHOOK_SECRET;
    if (loopSecret && (req.headers.get("authorization") ?? "") !== loopSecret) {
      // Only reject when the request actually looks like LoopMessage (carries an
      // auth header attempt); Twilio/Telnyx have their own paths and no header.
      const auth = req.headers.get("authorization");
      if (auth !== null) return new Response("unauthorized", { status: 401 });
    }

    let from = "";
    let body = "";
    const contentType = req.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        const json = (await req.json()) as {
          event?: string;
          contact?: string;
          text?: string;
          data?: { payload?: { from?: { phone_number?: string }; text?: string } };
        };
        if (json.event !== undefined) {
          // LoopMessage: only inbound messages are replies; ack everything else.
          if (json.event !== "message_inbound") return new Response("ok", { status: 200 });
          from = json.contact ?? "";
          body = json.text ?? "";
        } else {
          // Telnyx
          from = json.data?.payload?.from?.phone_number ?? "";
          body = json.data?.payload?.text ?? "";
        }
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
