import type { MetadataRoute } from "next";
import { IS_STAGING } from "@/lib/deploy-env";

const SITE_URL = "https://studiopulse.tech";

/* Search and AI crawlers welcome on the public site.

   The AI assistants are named one by one because a crawler that finds its own
   User-agent group reads ONLY that group: anything left in "*" alone does not
   apply to it. So every group carries the same rules.

   The disallowed paths are private by nature (token links, client portals,
   payment links, the sales sheet) or are the signed-in app, which redirects
   to sign-in anyway. /vs names a rival and stays out of search. Staging is a
   public URL full of test data, so it is closed to everyone. */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
  "cohere-ai",
  "meta-externalagent",
  "DuckAssistBot",
];

const PRIVATE = [
  "/api/",
  "/portal",
  "/pay/",
  "/files/",
  "/sign/",
  "/royalty/",
  "/invite",
  "/preview",
  "/mypulse",
  "/vs",
  "/kiosk",
  "/onboard",
  "/welcome",
  "/agency",
  "/billing",
  "/ui-lab",
];

export default function robots(): MetadataRoute.Robots {
  if (IS_STAGING) return { rules: { userAgent: "*", disallow: "/" } };
  const rule = { allow: "/", disallow: PRIVATE };
  return {
    rules: [{ userAgent: "*", ...rule }, ...AI_CRAWLERS.map((userAgent) => ({ userAgent, ...rule }))],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
