import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";

const http = httpRouter();

/* Stripe webhook receiver — verifies signature, dispatches to
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

export default http;
