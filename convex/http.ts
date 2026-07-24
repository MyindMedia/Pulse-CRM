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
    const state = url.searchParams.get("state");
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    if (!code || !state) {
      return Response.redirect(`${appUrl}/settings?google=error`, 302);
    }
    try {
      // CSRF: resolve the org from the single-use server-side nonce, NOT from a
      // client-controlled state value. A forged callback yields no org and is
      // rejected.
      const orgId = await ctx.runMutation(internal.googleAuth._consumeOAuthState, { nonce: state });
      if (!orgId) {
        return Response.redirect(`${appUrl}/settings?google=error`, 302);
      }
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
    // Auth (fail closed): the inbound webhook must present the configured shared
    // secret, as the Authorization header OR a ?token= query param. Without this
    // any anonymous POST could forge inbound SMS to opt phone numbers in/out
    // (STOP/START) or inject "client" messages into a thread. A missing secret
    // is treated as a deny so a misconfiguration can't leave it wide open.
    // Configure SMS_INBOUND_SECRET (or LOOPMESSAGE_WEBHOOK_SECRET) and append it
    // to each provider's webhook URL, e.g. /sms/inbound?token=<secret>.
    const secret = process.env.SMS_INBOUND_SECRET || process.env.LOOPMESSAGE_WEBHOOK_SECRET;
    const presented =
      req.headers.get("authorization") ?? new URL(req.url).searchParams.get("token") ?? "";
    if (!secret || presented !== secret) {
      return new Response("unauthorized", { status: 401 });
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

/* Waitlist unsubscribe - one-click link in every nurture/newsletter email.
   Flips the subscriber to "unsubscribed" (idempotent, never throws) and returns
   a small confirmation page. Email-in-querystring is standard for a marketing
   list and low-risk here (worst case someone opts another address out of a
   prospect newsletter). */
http.route({
  path: "/unsubscribe",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const email = url.searchParams.get("email") ?? url.searchParams.get("e") ?? "";
    if (email) await ctx.runMutation(internal.subscribers.unsubscribeByEmail, { email });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed - Pulse</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0d0d0f;color:#f4f2ee;">
  <div style="max-width:460px;margin:16vh auto;padding:0 24px;text-align:center;">
    <p style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#fdb913;margin:0 0 14px;">Pulse</p>
    <h1 style="font-size:26px;margin:0 0 12px;">You're unsubscribed</h1>
    <p style="font-size:15px;line-height:1.6;color:#b7b3aa;margin:0;">You won't get any more waitlist emails from Pulse. Changed your mind? You can rejoin from the site anytime.</p>
  </div>
</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }),
});

export default http;
