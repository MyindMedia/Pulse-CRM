/* Which copy of Pulse this build is. "staging" is the develop branch on its
   own Netlify site, against the Convex dev deployment and Clerk's
   development instance (docs/ENVIRONMENTS.md). Anything else is production.
   NEXT_PUBLIC_* is inlined at build time, so this is fixed per deploy. */
export const IS_STAGING = process.env.NEXT_PUBLIC_DEPLOY_ENV === "staging";
