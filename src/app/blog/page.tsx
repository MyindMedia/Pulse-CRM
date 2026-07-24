import type { Metadata } from "next";
import Link from "next/link";
import { BlogShell } from "@/components/marketing/blog-shell";
import { posts } from "@/content/blog";

export const metadata: Metadata = {
  title: "Blog | Pulse",
  description:
    "Playbooks on running a recording studio: cutting no-shows, filling rooms, pricing sessions, and turning a busy calendar into a profitable one.",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: "The Pulse Blog",
    description: "Playbooks on running a profitable recording studio.",
    url: "/blog",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Pulse Blog",
    description: "Playbooks on running a profitable recording studio.",
  },
};

/* Static: cornerstone SEO content, crawled signed-out. Middleware exempts
   /blog so anonymous crawlers reach it without a sign-in redirect. */
export const dynamic = "force-static";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export default function BlogIndex() {
  return (
    <BlogShell>
      <header className="mb-12">
        <p className="mb-3 font-grotesk text-xs uppercase tracking-[0.18em] text-gold">The Pulse Blog</p>
        <h1 className="font-grotesk text-4xl font-semibold tracking-[-0.02em] text-bone sm:text-5xl">
          Run a studio that fills itself
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-mist">
          Field-tested playbooks on bookings, no-shows, pricing, and the operations that turn a busy
          calendar into a profitable one.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="text-mist">New posts are on the way.</p>
      ) : (
        <ul className="space-y-4">
          {posts.map(({ meta }) => (
            <li key={meta.slug}>
              <Link
                href={`/blog/${meta.slug}`}
                className="group block rounded-chrome border border-white/8 bg-coal/30 p-6 transition-colors hover:border-gold/30 hover:bg-coal/50"
              >
                <p className="font-grotesk text-xs uppercase tracking-[0.12em] text-mist/70">
                  {formatDate(meta.date)}
                  {meta.tags?.length ? <span className="text-gold"> · {meta.tags[0]}</span> : null}
                </p>
                <h2 className="mt-2 font-grotesk text-xl font-semibold text-bone transition-colors group-hover:text-gold-bright">
                  {meta.title}
                </h2>
                <p className="mt-2 leading-relaxed text-mist">{meta.description}</p>
                <span className="mt-3 inline-block font-grotesk text-sm font-medium text-gold">
                  Read more
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlogShell>
  );
}
