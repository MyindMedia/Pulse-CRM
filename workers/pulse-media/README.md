# pulse-media Worker

Public read-only front for the `pulse-media` R2 bucket (Cloudflare account "Pulse OS"). Range requests, CDN cache, CORS.
Deploy: `scripts/r2/deploy-media-worker.sh` (uses the 1Password token, no wrangler needed).
Move to `media.studiopulse.tech` later by putting the domain's DNS on Cloudflare and adding a custom domain to the bucket; the app only reads `R2_PUBLIC_URL`.
