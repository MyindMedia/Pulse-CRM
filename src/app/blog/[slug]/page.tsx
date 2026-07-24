import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogShell, Prose } from "@/components/marketing/blog-shell";
import { allSlugs, getPost } from "@/content/blog";

type Params = { params: Promise<{ slug: string }> };

/* Pre-render one static page per published post so search engines get a fast,
   fully-rendered document with real meta tags. */
export function generateStaticParams(): { slug: string }[] {
  return allSlugs().map((slug) => ({ slug }));
}

/* No slugs outside the collection: unknown -> 404, not a soft-render. */
export const dynamicParams = false;
export const dynamic = "force-static";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Not found | Pulse" };
  const { meta } = post;
  const url = `/blog/${meta.slug}`;
  return {
    title: `${meta.title} | Pulse`,
    description: meta.description,
    keywords: meta.tags,
    authors: meta.author ? [{ name: meta.author }] : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: meta.title,
      description: meta.description,
      url,
      publishedTime: meta.date,
      authors: meta.author ? [meta.author] : undefined,
      tags: meta.tags,
      ...(meta.ogImage ? { images: [{ url: meta.ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      ...(meta.ogImage ? { images: [meta.ogImage] } : {}),
    },
  };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export default async function BlogPost({ params }: Params) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const { meta, Body } = post;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    author: { "@type": "Organization", name: meta.author ?? "Pulse" },
    publisher: { "@type": "Organization", name: "Pulse by Myind Sound" },
    mainEntityOfPage: `https://pulse.myindsound.com/blog/${meta.slug}`,
    keywords: meta.tags?.join(", "),
  };

  return (
    <BlogShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav className="mb-8">
        <Link href="/blog" className="font-grotesk text-sm text-gold hover:text-gold-bright">
          &larr; All posts
        </Link>
      </nav>

      <article>
        <header className="mb-10 border-b border-white/8 pb-8">
          <p className="mb-3 font-grotesk text-xs uppercase tracking-[0.14em] text-mist/70">
            {formatDate(meta.date)}
            {meta.author ? <span> · {meta.author}</span> : null}
          </p>
          <h1 className="font-grotesk text-3xl font-semibold leading-tight tracking-[-0.02em] text-bone sm:text-4xl">
            {meta.title}
          </h1>
          {meta.tags?.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {meta.tags.map((t) => (
                <li
                  key={t}
                  className="rounded-chrome border border-gold/20 px-2.5 py-1 font-grotesk text-xs uppercase tracking-[0.08em] text-gold"
                >
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        <Prose>
          <Body />
        </Prose>
      </article>

      <footer className="mt-14 rounded-chrome border border-gold/25 bg-coal/40 p-6">
        <p className="font-grotesk text-lg font-semibold text-bone">Run this loop automatically.</p>
        <p className="mt-2 leading-relaxed text-mist">
          Pulse handles deposits, reminders, and waitlist backfill for your studio out of the box.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-chrome bg-gold px-5 py-2.5 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-transform hover:-translate-y-0.5 hover:bg-gold-bright"
        >
          See Pulse
        </Link>
      </footer>
    </BlogShell>
  );
}
