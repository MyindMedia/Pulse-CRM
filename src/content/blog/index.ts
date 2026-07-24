import type { ComponentType } from "react";
import type { Post, PostMeta } from "./types";
import * as noShows from "./recording-studio-no-shows";

/* File-based content collection. To publish a cornerstone post:
     1. add src/content/blog/<slug>.tsx exporting `meta: PostMeta` + default Body
     2. import it and add it to POST_MODULES below
   No CMS, no build step - the /blog index and /blog/[slug] routes read from here
   and Next statically generates a page per post. */

type PostModule = { meta: PostMeta; default: ComponentType };

const POST_MODULES: PostModule[] = [noShows];

const ALL: Post[] = POST_MODULES.map((m) => ({ meta: m.meta, Body: m.default }));

/** Published posts (drafts excluded), newest first. */
export const posts: Post[] = ALL.filter((p) => !p.meta.draft).sort((a, b) =>
  b.meta.date.localeCompare(a.meta.date),
);

export function getPost(slug: string): Post | undefined {
  return posts.find((p) => p.meta.slug === slug);
}

export function allSlugs(): string[] {
  return posts.map((p) => p.meta.slug);
}
