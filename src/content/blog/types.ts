import type { ComponentType } from "react";

/** Front-matter for a cornerstone SEO post. Everything here feeds either the
 *  index list or the per-post <head> (title / meta description / OpenGraph). */
export type PostMeta = {
  /** URL segment: /blog/<slug>. Lowercase, hyphenated, stable once published. */
  slug: string;
  /** <title> and OG title. Keep under ~60 chars for SERP display. */
  title: string;
  /** Meta description + OG description. ~150-160 chars, benefit-led. */
  description: string;
  /** ISO date (YYYY-MM-DD). Drives sort order + article:published_time. */
  date: string;
  /** Short author label shown on the post. */
  author?: string;
  /** Absolute or root-relative OG image. Falls back to the site card. */
  ogImage?: string;
  /** Skimmable tags shown on the post (also good internal-link anchors). */
  tags?: string[];
  /** Set true to keep a draft out of the index + sitemap. */
  draft?: boolean;
};

/** A published post = its front-matter plus a body component (the article). */
export type Post = {
  meta: PostMeta;
  Body: ComponentType;
};
