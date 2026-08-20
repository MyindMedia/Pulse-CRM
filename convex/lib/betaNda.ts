/* ============================================================
   The beta agreement.

   Kept here as data rather than markup so the server can hash the
   exact text a person saw. If the terms are ever edited, previously
   captured signatures still point at the version they actually
   agreed to, and the new version gets a new id. That is the whole
   difference between a signature record and a decorative checkbox.

   NOT legal advice. This is a short, plain mutual-confidentiality
   agreement for a private product preview; have a lawyer read it
   before it goes to anyone who matters.
   ============================================================ */

export const NDA_VERSION = "2026-08-20.2";

export const NDA_TITLE = "Pulse Early Access and Confidentiality Agreement";

export const NDA_INTRO =
  "You are being given access to an unreleased product, including features that are not built yet. This agreement covers what you may do with what you see: keep it to yourself, and use it only to decide whether Pulse is right for your studio. Please read it, then type your name to accept.";

export const NDA_CLAUSES: { heading: string; body: string }[] = [
  {
    heading: "What is confidential",
    body:
      "Everything behind this page: the feature list, screenshots, pricing, roadmap, and anything shown to you in a demo or conversation about Pulse. Treat it as confidential whether or not it is marked so.",
  },
  {
    heading: "What you agree not to do",
    body:
      "Do not share, publish, post, screenshot, forward, or describe this material to anyone outside your own organization without written permission from Myind Sound. That includes social media, group chats, and newsletters.",
  },
  {
    heading: "Who you may share it with",
    body:
      "People inside your own organization who need to evaluate Pulse with you, on the condition that you make them aware of these terms and remain responsible for them.",
  },
  {
    heading: "What you may use it for",
    body:
      "Evaluating Pulse for your own studio, and nothing else. You may not use what you see here to build, specify, fund, or help anyone else build a product that competes with Pulse. This is the clause that matters most to us: you are being shown an unreleased roadmap, and we are relying on you not to take it somewhere else.",
  },
  {
    heading: "No copying or reverse engineering",
    body:
      "Do not copy, recreate, or make derivative works from the Pulse interface, feature set, workflows, or documentation. Do not reverse engineer, decompile, or attempt to derive the source of anything you are given access to, or use automated tools to scrape or extract it.",
  },
  {
    heading: "Who owns what",
    body:
      "Pulse, its interface, its underlying software, and everything on these pages remain the property of Myind Sound. Nothing here grants you a licence to use, reproduce, or build on any of it beyond looking at it to decide whether you want it. Your own business, data, recordings and material remain entirely yours.",
  },
  {
    heading: "What you may say publicly",
    body:
      "That you are evaluating Pulse. Nothing about unreleased features, pricing, timelines, or anything else on this page.",
  },
  {
    heading: "No promises about the product",
    body:
      "This is a preview of work in progress. Features shown may change, be delayed, or be removed. Nothing here is a commitment to build or ship anything, and nothing here is an offer or a contract to supply the product.",
  },
  {
    heading: "Your feedback",
    body:
      "If you tell us what you think, we may use that feedback to improve Pulse without owing you anything for it. You keep everything you already own; you are not assigning us any of your own material.",
  },
  {
    heading: "How long this lasts",
    body:
      "Two years from the date you sign, or until the information becomes public through no fault of yours, whichever comes first.",
  },
  {
    heading: "Ending access",
    body:
      "We can withdraw your access at any time. If we ask, delete or return any copies of preview material you are holding.",
  },
  {
    heading: "The usual carve-outs",
    body:
      "None of this applies to information you already knew, that becomes public on its own, that you get lawfully from someone else, or that you are legally required to disclose. If you are compelled to disclose, tell us first if you are allowed to.",
  },
];

/** The exact text a signature is bound to. Order and wording matter: this is
 *  what gets hashed, so any edit produces a different hash. */
export function ndaCanonicalText(): string {
  return [
    NDA_TITLE,
    `Version ${NDA_VERSION}`,
    NDA_INTRO,
    ...NDA_CLAUSES.map((c) => `${c.heading}: ${c.body}`),
  ].join("\n");
}

/**
 * A stable, dependency-free hash of the agreement text.
 *
 * FNV-1a, chosen because Convex's V8 runtime has no synchronous crypto and
 * this does not need to be cryptographic: it exists to detect that the terms
 * changed, not to resist an attacker. If that requirement ever changes, swap
 * in a real digest and bump NDA_VERSION.
 */
export function hashTerms(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, "0")}-${text.length}`;
}

export const NDA_TERMS_HASH = hashTerms(ndaCanonicalText());
