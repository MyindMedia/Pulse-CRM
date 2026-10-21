import type { MetadataRoute } from "next";

const SITE_URL = "https://studiopulse.tech";

// The public pages, on the one canonical host. The signed-in app, token links
// and /vs (noindex) are left out on purpose.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<[string, number]> = [
    ["", 1],
    ["/pricing", 0.9],
    ["/mobile", 0.7],
    ["/studios", 0.6],
    ["/support", 0.4],
    ["/privacy", 0.2],
    ["/terms", 0.2],
  ];
  return pages.map(([path, priority]) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
