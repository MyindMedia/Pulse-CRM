import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { api } from "@convex/_generated/api";
import { publicConvex } from "@/lib/convex-server";
import { getGoogleBadges } from "@/lib/google-places";
import { jsonLdHtml, SITE_URL } from "@/components/marketing/structured-data";
import { ListingCard } from "@/components/studios/listing-card";

/* City Page (openspec/changes/google-reviews-studio-seo): the Listed Studios
   in one city, for "recording studio in <city>" searches. Exists only once
   two or more studios share the city; otherwise 404. */

export const revalidate = 3600;

type Params = { params: Promise<{ city: string }> };

async function load(slug: string) {
  try {
    return await publicConvex().query(api.directory.city, { slug });
  } catch {
    return null;
  }
}

const label = (c: { city: string; region: string | null }) => [c.city, c.region].filter(Boolean).join(", ");

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city } = await params;
  const c = await load(city);
  if (!c) return { title: "City not found", robots: { index: false } };
  const title = `Recording studios in ${label(c)}`;
  const description = `${c.listings.length} recording studios in ${label(c)} with live open dates and real hourly rates. Book straight with the studio.`;
  return { title, description, alternates: { canonical: `/studios/in/${city}` }, openGraph: { title, description, url: `/studios/in/${city}` } };
}

export default async function CityPage({ params }: Params) {
  const { city } = await params;
  const c = await load(city);
  if (!c) notFound();
  const google = await getGoogleBadges(c.listings.map((l) => l.googlePlaceId));
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Recording studios in ${label(c)}`,
      url: `${SITE_URL}/studios/in/${c.slug}`,
      numberOfItems: c.listings.length,
      itemListElement: c.listings.map((l, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/studios/${l.slug}`,
        name: l.name,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Find a studio", item: `${SITE_URL}/studios` },
        { "@type": "ListItem", position: 2, name: c.city, item: `${SITE_URL}/studios/in/${c.slug}` },
      ],
    },
  ];
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <nav aria-label="Breadcrumb">
        <Link href="/studios" className="inline-flex items-center gap-1 text-xs text-steel hover:text-bone">
          <ChevronLeft className="size-3.5" /> Find a studio
        </Link>
      </nav>
      <header className="mt-5 max-w-2xl">
        <h1 className="font-grotesk text-3xl font-bold tracking-tight text-bone sm:text-4xl">
          Recording studios in {label(c)}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-steel">
          {c.listings.length} studios in {c.city} take bookings through Pulse. Rates and open dates come from each
          studio&apos;s live calendar, and the booking goes straight to the studio with no commission.
        </p>
      </header>
      <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {c.listings.map((l) => (
          <li key={l.slug} className="min-w-0">
            <ListingCard l={l} google={l.googlePlaceId ? google[l.googlePlaceId] : undefined} />
          </li>
        ))}
      </ul>
    </main>
  );
}
