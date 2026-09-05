import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  PRIMARY_ORIGIN,
  SATELLITE_PROXY_URL,
  isSatelliteHost,
} from "@/lib/clerk-domains";

/*
 * Clerk middleware - only enforced when Clerk is configured.
 * In demo mode (no publishable key) requests pass straight through so the
 * app is fully explorable against seeded data.
 */

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/*
 * Multi-domain. Which host is primary and which is the satellite lives in one
 * place - see src/lib/clerk-domains.ts, and read the note there before moving
 * either, because the publishable key has to move with it. Sign-in itself can
 * only happen on the primary; satellite visitors bounce there and return
 * signed in.
 */

const isPublicRoute = createRouteMatcher([
  "/",
  "/opengraph-image(.*)", // social share card - must be scrapeable
  "/twitter-image(.*)", // social share card - must be scrapeable
  "/welcome/activate(.*)", // pay-first signup: reached before the account exists
  // Legal pages must stay anonymous-reachable: A2P 10DLC / TCR campaign review
  // fetches them signed-out, and a 307 to /sign-in reads to the reviewer as
  // "no privacy policy" - which is exactly why a campaign was rejected before.
  "/privacy",
  "/terms",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  // GHL's Social Planner fetches this PNG server to server, signed out, to
  // composite it into a post - a 307 to /sign-in here would hand it an HTML
  // redirect instead of an image and silently break every brand-card post.
  // The post id is unguessable and the data query exposes display fields
  // only, so anonymous access carries no secret.
  //
  // The route is /api/brand-card/[postId]/[kind]/[version] (kind and the
  // post's updatedAt live in the path, not a query string, so Netlify's
  // path-only CDN cache key actually varies with them - see
  // convex/lib/brandCardUrl.ts). `(.*)` matches every segment after
  // /api/brand-card/ including the slashes between them, so this one
  // matcher still covers the full three-segment path.
  "/api/brand-card/(.*)",
  // NOTE: these matchers need the explicit "/" before "(.*)" - a bare
  // "/book(.*)" also matches sibling APP routes (/bookings, /payments,
  // /visitors), silently exempting them from the sign-in redirect.
  "/book", // public studio booking (demo front) - no login
  "/book/(.*)", // public studio booking by slug - no login
  "/pay/(.*)", // public invoice payment link - no login
  "/invite(.*)", // beta invite account-creation screen - no auth required
  "/portal(.*)", // client concierge magic-link portal - token-authed, no login
  "/sign(.*)", // split-sheet e-signature magic-link - token-authed, no login
  "/visit/(.*)", // visitor QR self check-in - org derived from the slug, no login
  // Public marketing + directory surfaces. These exist FOR people who have no
  // account, so protecting them 404s exactly the audience they were built for
  // (auth.protect() 404s rather than redirecting on the satellite host).
  "/studios", // Find a Studio directory - artists searching, not customers
  "/studios/(.*)",
  "/vs", // comparison page - a search result, must be anonymous-reachable
  // Beta preview: recipients are gated by their own access code and the signed
  // agreement, checked server-side. They have no Pulse login yet by design.
  "/preview",
  "/preview/(.*)",
  // Sales enablement. Gated by its own shared password (src/app/mypulse/auth.ts),
  // not by Clerk - the people who read it are reps and partners with no Pulse
  // login, and auth.protect() 404s them on the satellite host.
  "/mypulse",
  "/mypulse/(.*)",
  "/__clerk(.*)", // satellite Frontend API proxy - handled by frontendApiProxy
]);

const handler = CLERK_ENABLED
  ? clerkMiddleware(
      async (auth, req) => {
        if (isSatelliteHost(req.nextUrl.hostname)) {
          // Satellites cannot host Clerk auth flows - forward /sign-in and
          // /sign-up to the primary, keeping the way back to this host.
          const path = req.nextUrl.pathname;
          if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) {
            const target = new URL(
              path.startsWith("/sign-up") ? "/sign-up" : "/sign-in",
              PRIMARY_ORIGIN,
            );
            const back =
              req.nextUrl.searchParams.get("redirect_url") ??
              new URL("/dashboard", req.nextUrl.origin).toString();
            target.searchParams.set("redirect_url", back);
            return NextResponse.redirect(target);
          }
          if (!isPublicRoute(req)) {
            // Default protect(): with the satellite options below, Clerk
            // runs its cross-domain handshake against the primary's signInUrl
            // and returns the visitor here signed in.
            await auth.protect();
          }
          return;
        }
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
      },
      (req) =>
        isSatelliteHost(req.nextUrl.hostname)
          ? {
              isSatellite: true,
              proxyUrl: SATELLITE_PROXY_URL,
              signInUrl: `${PRIMARY_ORIGIN}/sign-in`,
              signUpUrl: `${PRIMARY_ORIGIN}/sign-up`,
              frontendApiProxy: {
                enabled: (url: URL) => isSatelliteHost(url.hostname),
              },
            }
          : {},
    )
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|m4v|mp3|wav|ogg)).*)",
    "/(api|trpc)(.*)",
    // Satellite FAPI proxy: must be matched explicitly - ClerkJS loads
    // /__clerk/npm/...clerk.browser.js, and .js is excluded above.
    "/__clerk(.*)",
  ],
};
