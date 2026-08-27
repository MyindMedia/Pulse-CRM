"use client";

import { useSearchParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { Composer } from "@/components/social/composer";

/** Write a post: /marketing/compose for a fresh draft, ?post=<id> to reopen
 *  an existing one (the inbox's "open in composer" link uses this for AI
 *  drafts), ?template=<key>&promo=<id> to arrive pre-seeded from a template
 *  or promo shortcut. All the actual state lives in <Composer>. */
export default function ComposePage() {
  const params = useSearchParams();
  const post = params.get("post");
  const template = params.get("template");
  const promo = params.get("promo");

  return (
    <Composer
      initialPostId={post ? (post as Id<"socialPosts">) : undefined}
      template={template}
      promoId={promo ? (promo as Id<"promos">) : undefined}
    />
  );
}
