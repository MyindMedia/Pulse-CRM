import type { Doc } from "../_generated/dataModel";

/* Catalog artists: the "Travis Scott" on a producer's imported credit. Every
   song needs an artists row, but these people are not the studio's clients,
   so they stay out of Clients, counts, pickers and suggestions (owner
   decision 2026-10-22). They carry no email or phone, so nothing messages
   them, and a real booking makes its own client row. */

/** A real client of the studio, as opposed to a name carried by an import. */
export function isClient(a: Pick<Doc<"artists">, "catalogOnly">): boolean {
  return a.catalogOnly !== true;
}

/** Normalised name for matching an imported artist to an existing row. */
export function artistKey(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
