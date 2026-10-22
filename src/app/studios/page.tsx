import type { Metadata } from "next";
import { api } from "@convex/_generated/api";
import { publicConvex } from "@/lib/convex-server";
import { getGoogleBadges } from "@/lib/google-places";
import { jsonLdHtml, SITE_URL } from "@/components/marketing/structured-data";
import { StudiosBrowser } from "@/components/studios/studios-browser";

/* Find a Studio, server-rendered (openspec/changes/google-reviews-studio-seo):
   every Listed Studio is in the HTML for search engines and AI crawlers, and
   the filters run live in the browser on top of it. */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Find a recording studio: open dates, rates and online booking",
  description:
    "Find recording and music studios with live open dates and real hourly rates, and book directly with the studio. No booking commission.",
  alternates: { canonical: "/studios" },
  openGraph: {
    title: "Find a studio on Pulse",
    description: "Recording studios with real rates and live open dates. Book straight with the studio.",
    url: "/studios",
  },
};

async function initialResults() {
  try {
    return await publicConvex().query(api.directory.search, {});
  } catch {
    return null;
  }
}

export default async function StudiosPage() {
  const initial = await initialResults();
  const google = await getGoogleBadges(initial?.listings.map((l) => l.googlePlaceId) ?? []);
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Recording studios on Pulse",
    url: `${SITE_URL}/studios`,
    numberOfItems: initial?.total ?? 0,
    itemListElement: (initial?.listings ?? []).map((l, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_URL}/studios/${l.slug}`,
      name: l.name,
    })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemList) }} />
      <StudiosBrowser initial={initial} google={google} />
    </>
  );
}
