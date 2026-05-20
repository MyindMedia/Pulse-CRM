/*
 * Convex trusts Clerk-issued JWTs from the "convex" template.
 * Set CLERK_JWT_ISSUER_DOMAIN on the Convex dashboard. When unset,
 * Pulse runs in demo mode (no auth) and falls back to the "pulse-demo" org.
 */
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN ?? "https://demo.pulse.invalid",
      applicationID: "convex",
    },
  ],
};

export default authConfig;
