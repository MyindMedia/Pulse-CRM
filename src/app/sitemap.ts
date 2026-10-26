import type { MetadataRoute } from "next";
import { directoryFeed } from "@/lib/directory-feed";

const SITE_URL = "https://studiopulse.tech";

// Rebuilt hourly so a studio that lists itself is in the sitemap the same day.
export const revalidate = 3600;

// The public pages, on the one canonical host. The signed-in app, token links
// and /vs (noindex) are left out on purpose. Studio Profiles and City Pages
// come from the directory: Listed Studios only, and only cities with a page.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: Array<[string, number]> = [
    ["", 1],
    ["/pricing", 0.9],
    ["/mobile", 0.7],
    ["/studios", 0.8],
    ["/support", 0.4],
    ["/privacy", 0.2],
    ["/terms", 0.2],
  ];
  const dir = await directoryFeed();
  const directory: Array<[string, number]> = [
    ...(dir?.cities ?? []).map((c): [string, number] => [`/studios/in/${c.slug}`, 0.7]),
    ...(dir?.studios ?? []).flatMap((s): Array<[string, number]> => [
      [`/studios/${s.slug}`, 0.6],
      [`/book/${s.slug}`, 0.5],
    ]),
  ];
  return [...pages, ...directory].map(([path, priority]) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
