import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, ChevronLeft, DoorOpen, MapPin } from "lucide-react";
import { api } from "@convex/_generated/api";
import { publicConvex } from "@/lib/convex-server";
import { getGooglePlace } from "@/lib/google-places";
import { jsonLdHtml, SITE_URL } from "@/components/marketing/structured-data";
import { GoogleRatingBadge, GoogleReviewsSection } from "@/components/google/google-reviews";
import { money } from "@/lib/format";

/* Studio Profile (openspec/changes/google-reviews-studio-seo): one Listed
   Studio, server-rendered for search engines and AI assistants, with a way
   to book. Only what the studio's own booking page already shows. */

export const revalidate = 3600;

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const client = publicConvex();
  try {
    const listing = await client.query(api.directory.listing, { slug });
    if (!listing) return null;
    const front = await client.query(api.booking.studioFront, { slug });
    return { listing, front };
  } catch {
    return null;
  }
}

function where(l: { city: string | null; region: string | null }) {
  return [l.city, l.region].filter(Boolean).join(", ");
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) return { title: "Studio not found", robots: { index: false } };
  const { listing: l } = d;
  const place = where(l);
  const title = `${l.name}${place ? `: recording studio in ${place}` : ": recording studio"}`;
  const bits = [
    l.blurb,
    `${l.roomCount} room${l.roomCount === 1 ? "" : "s"}`,
    l.fromHourlyCents !== null ? `from ${money(l.fromHourlyCents)} an hour` : null,
    "Book online with live open dates.",
  ].filter(Boolean);
  const description = bits.join(". ").replace(/\s+/g, " ").replace(/\.\./g, ".");
  return {
    title,
    description,
    alternates: { canonical: `/studios/${slug}` },
    openGraph: {
      title,
      description,
      url: `/studios/${slug}`,
      ...(l.heroUrl ? { images: [{ url: l.heroUrl, alt: l.name }] } : {}),
    },
  };
}

function openLabel(at: number | null): string {
  if (at === null) return "Booked out for the next two weeks";
  const days = Math.round((at - Date.now()) / 86_400_000);
  if (days <= 0) return "Free today";
  if (days === 1) return "Free tomorrow";
  return `Next free day in ${days} days`;
}

export default async function StudioProfilePage({ params }: Params) {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) notFound();
  const { listing: l, front } = d;
  const google = await getGooglePlace(l.googlePlaceId, "full");
  const rooms = (front?.rooms ?? []) as Array<{
    _id: string;
    name: string;
    roomType?: string;
    hourlyRateCents?: number;
    photos?: string[];
    gearPreview?: string[];
  }>;
  const place = where(l);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": `${SITE_URL}/studios/${l.slug}#studio`,
      name: l.name,
      description: l.blurb ?? undefined,
      url: `${SITE_URL}/studios/${l.slug}`,
      image: l.heroUrl ?? l.logoUrl ?? undefined,
      logo: l.logoUrl ?? undefined,
      keywords: ["recording studio", ...l.services, ...l.tags].join(", "),
      ...(l.city || l.region
        ? {
            address: {
              "@type": "PostalAddress",
              ...(l.city ? { addressLocality: l.city } : {}),
              ...(l.region ? { addressRegion: l.region } : {}),
            },
          }
        : {}),
      ...(l.fromHourlyCents !== null ? { priceRange: `From ${money(l.fromHourlyCents)} per hour` } : {}),
      potentialAction: {
        "@type": "ReserveAction",
        target: `${SITE_URL}${l.bookingPath}`,
        name: `Book ${l.name}`,
      },
      ...(rooms.length
        ? {
            makesOffer: rooms.map((r) => ({
              "@type": "Offer",
              name: r.name,
              ...(r.hourlyRateCents
                ? {
                    priceSpecification: {
                      "@type": "UnitPriceSpecification",
                      price: (r.hourlyRateCents / 100).toFixed(2),
                      priceCurrency: "USD",
                      unitCode: "HUR",
                    },
                  }
                : {}),
            })),
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Find a studio", item: `${SITE_URL}/studios` },
        ...(l.hasCityPage && l.citySlug && l.city
          ? [{ "@type": "ListItem", position: 2, name: l.city, item: `${SITE_URL}/studios/in/${l.citySlug}` }]
          : []),
        { "@type": "ListItem", position: l.hasCityPage && l.city ? 3 : 2, name: l.name, item: `${SITE_URL}/studios/${l.slug}` },
      ],
    },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />

      <nav aria-label="Breadcrumb">
        <Link href="/studios" className="inline-flex items-center gap-1 text-xs text-steel hover:text-bone">
          <ChevronLeft className="size-3.5" /> Find a studio
        </Link>
      </nav>

      {l.heroUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={l.heroUrl} alt={`${l.name} studio`} className="mt-5 h-56 w-full rounded-lg object-cover sm:h-72" />
      )}

      <header className="mt-6 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {l.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.logoUrl} alt={`${l.name} logo`} className="size-12 shrink-0 rounded-md object-contain" />
          )}
          <div className="min-w-0">
            <h1 className="font-grotesk text-3xl font-bold tracking-tight text-bone sm:text-4xl">{l.name}</h1>
            {place && (
              <p className="mt-1 flex items-center gap-1 text-sm text-steel">
                <MapPin className="size-3.5" />
                Recording studio in {place}
              </p>
            )}
          </div>
        </div>
        {google && <GoogleRatingBadge place={google} className="self-start" />}
        {l.blurb && <p className="max-w-2xl text-base leading-relaxed text-mist/85">{l.blurb}</p>}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-steel">
          <span className="flex items-center gap-1.5">
            <DoorOpen className="size-4 text-steel/60" />
            {l.roomCount} room{l.roomCount === 1 ? "" : "s"}
          </span>
          {l.fromHourlyCents !== null && (
            <span>
              from <span className="text-bone">{money(l.fromHourlyCents)}</span> an hour
            </span>
          )}
          <span className="flex items-center gap-1.5 text-gold">
            <CalendarCheck className="size-4" />
            {openLabel(l.nextOpenAt)}
          </span>
        </div>
        {l.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="What the studio offers">
            {l.tags.map((t) => (
              <li key={t} className="rounded border border-graphite/60 px-2 py-0.5 text-xs text-steel">
                {t}
              </li>
            ))}
          </ul>
        )}
        <div>
          <Link
            href={l.bookingPath}
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-gold px-6 py-3 font-grotesk text-sm font-semibold text-gold-ink hover:bg-gold-bright"
          >
            {front?.pricingHidden ? "Request a booking" : "See open dates and book"}
          </Link>
        </div>
      </header>

      {rooms.length > 0 && (
        <section aria-labelledby="rooms-h" className="mt-12">
          <h2 id="rooms-h" className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            Rooms
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rooms.map((r) => (
              <li key={r._id} className="min-w-0 overflow-hidden rounded-lg border border-graphite/50 bg-coal-2">
                {r.photos?.[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photos[0]} alt={r.name} className="h-36 w-full object-cover" loading="lazy" />
                )}
                <div className="flex flex-col gap-1 p-4">
                  <h3 className="font-grotesk text-sm font-semibold text-bone">{r.name}</h3>
                  <p className="text-xs text-steel">
                    {[r.roomType, r.hourlyRateCents ? `${money(r.hourlyRateCents)} an hour` : null].filter(Boolean).join(" · ")}
                  </p>
                  {r.gearPreview && r.gearPreview.length > 0 && (
                    <p className="text-xs text-steel/80">Gear: {r.gearPreview.join(", ")}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {google && <GoogleReviewsSection place={google} className="mt-12" />}

      {front && front.reviewStats.count > 0 && (
        <section aria-labelledby="pulse-reviews-h" className="mt-12">
          <h2 id="pulse-reviews-h" className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            From clients who booked on Pulse
          </h2>
          <p className="mt-1 text-xs text-steel/70">Showing reviews rated 4 or 5 stars.</p>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {front.reviews
              .filter((r) => r.text)
              .map((r, i) => (
                <li key={i} className="min-w-0 rounded-md border border-graphite/40 p-4 text-sm text-mist/85">
                  <p className="line-clamp-6">{r.text}</p>
                  {r.authorName && <p className="mt-2 text-xs text-steel">{r.authorName}</p>}
                </li>
              ))}
          </ul>
        </section>
      )}

      <p className="mt-14 border-t border-graphite/50 pt-5 text-xs text-steel/60">
        {l.name} takes bookings through Pulse. The booking goes straight to the studio, with no commission.{" "}
        {l.hasCityPage && l.citySlug && l.city ? (
          <Link href={`/studios/in/${l.citySlug}`} className="text-gold underline-offset-2 hover:underline">
            More studios in {l.city}
          </Link>
        ) : (
          <Link href="/studios" className="text-gold underline-offset-2 hover:underline">
            More studios
          </Link>
        )}
      </p>
    </main>
  );
}
