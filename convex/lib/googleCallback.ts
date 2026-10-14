import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { exchangeCode, emailFromIdToken } from "./google";
import type { GoogleCallbackReason } from "./googleReasons";

/* The Google OAuth callback, for both levels: the studio's own connect and a
   team member's personal calendar. Every failure redirects back with
   `google=error&reason=<code>` so the settings screen can say what happened
   instead of a generic "error". The nonce is always consumed first: it is
   single-use, and it tells us which level (and so which screen) to return to. */

export function callbackTarget(appUrl: string, level: "studio" | "member", result: "connected" | GoogleCallbackReason): string {
  const base = level === "member" ? `${appUrl}/schedule` : `${appUrl}/settings`;
  const params = new URLSearchParams();
  if (level === "studio") params.set("tab", "integrations");
  if (result === "connected") params.set("google", "connected");
  else {
    params.set("google", "error");
    params.set("reason", result);
  }
  return `${base}?${params.toString()}`;
}

export async function handleGoogleCallback(ctx: ActionCtx, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  let level: "studio" | "member" = "studio";
  const go = (result: "connected" | GoogleCallbackReason) =>
    Response.redirect(callbackTarget(appUrl, level, result), 302);

  try {
    // CSRF: the org (and member) come from the single-use server-side nonce,
    // never from a client-controlled value. A forged callback yields nothing.
    const resolved = state ? await ctx.runMutation(internal.googleAuth._consumeState, { nonce: state }) : null;
    if (resolved?.memberId) level = "member";
    if (!resolved) return go(googleError === "access_denied" ? "access_denied" : "state_mismatch");
    if (googleError) return go(googleError === "access_denied" ? "access_denied" : "exchange_failed");
    if (!code) return go("missing_code");

    let tokens;
    try {
      tokens = await exchangeCode(code);
    } catch {
      return go("exchange_failed");
    }
    // Without a refresh token the connection looks fine for an hour and then
    // dies silently. Treat it as the failure it is.
    if (!tokens.refresh_token) return go("no_refresh_token");

    const email = emailFromIdToken(tokens.id_token) ?? undefined;
    if (resolved.memberId) {
      await ctx.runMutation(internal.memberCalendar._storeMemberTokens, {
        orgId: resolved.orgId,
        memberId: resolved.memberId,
        refreshToken: tokens.refresh_token,
        email,
      });
    } else {
      await ctx.runMutation(internal.googleAuth._storeTokens, {
        orgId: resolved.orgId,
        refreshToken: tokens.refresh_token,
        email,
      });
    }
    return go("connected");
  } catch (err) {
    console.error("[google/callback]", err);
    return go("server_error");
  }
}
