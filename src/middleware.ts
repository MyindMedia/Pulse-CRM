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
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/book(.*)", // public studio booking - no login
  "/pay(.*)", // public invoice payment link - no login
  "/invite(.*)", // beta invite account-creation screen - no auth required
]);

const handler = CLERK_ENABLED
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) await auth.protect();
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
