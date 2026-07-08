import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/*
 * Clerk middleware - only enforced when Clerk is configured.
 * In demo mode (no publishable key) requests pass straight through so the
 * app is fully explorable against seeded data.
 */

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const isPublicRoute = createRouteMatcher([
  "/",
  "/opengraph-image(.*)", // social share card - must be scrapeable
  "/twitter-image(.*)", // social share card - must be scrapeable
  "/welcome/activate(.*)", // pay-first signup: reached before the account exists
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/book(.*)", // public studio booking - no login
  "/pay(.*)", // public invoice payment link - no login
  "/invite(.*)", // beta invite account-creation screen - no auth required
  "/portal(.*)", // client concierge magic-link portal - token-authed, no login
  "/sign(.*)", // split-sheet e-signature magic-link - token-authed, no login
]);

const handler = CLERK_ENABLED
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        // Send unauthenticated traffic to OUR /sign-in (same origin), not the
        // Clerk-hosted accounts.dev page. Client-side RSC/prefetch fetches that
        // hit an expired session used to get 307'd cross-origin and die as
        // CORS errors in the console; a same-origin redirect resolves cleanly
        // and keeps the return path via redirect_url.
        const signIn = new URL("/sign-in", req.url);
        signIn.searchParams.set("redirect_url", req.url);
        await auth.protect({ unauthenticatedUrl: signIn.toString() });
      }
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|m4v|mp3|wav|ogg)).*)",
    "/(api|trpc)(.*)",
  ],
};
