import type { Metadata } from "next";
import { api } from "@convex/_generated/api";
import { publicConvex } from "@/lib/convex-server";
import { getGooglePlace } from "@/lib/google-places";
import { GooglePlaceProvider } from "@/components/google/google-place-context";

/* Server half of the booking page (openspec/changes/google-reviews-studio-seo).
   The page itself is live and client-rendered; this layout gives crawlers a
   real title and description, and fetches the studio's Google listing on the
   server when the studio chose to show it. */

export const revalidate = 3600;

type Params = { params: Promise<{ slug: string }> };

async function meta(slug: string) {
  try {
    return await publicConvex().query(api.directory.pageMeta, { slug });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const m = await meta(slug);
  if (!m) return { title: "Studio booking", robots: { index: false } };
  const where = [m.city, m.region].filter(Boolean).join(", ");
  const title = `Book ${m.name}${where ? `, ${where}` : ""}`;
  const description =
    m.description ?? `Book a session at ${m.name}${where ? ` in ${where}` : ""}: see open dates and rooms, and book online.`;
  return {
    title,
    description,
    alternates: { canonical: `/book/${slug}` },
    openGraph: { title, description, url: `/book/${slug}` },
  };
}

export default async function BookingSlugLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { slug } = await params;
  const m = await meta(slug);
  const place = await getGooglePlace(m?.googlePlaceId, "full");
  return <GooglePlaceProvider place={place}>{children}</GooglePlaceProvider>;
}
