/* ============================================================
   Finding a piece of gear in a list of gear.

   Someone standing at a rack types what is written on the box:
   a model, a serial, a room. They do not type it the way it was
   entered, so matching is on words rather than on the whole
   string - "neve 1073" finds "AMS Neve 1073DPX", and typing a
   serial finds the one unit even when the name is generic.
   ============================================================ */

export type SearchableItem = {
  name: string;
  category?: string;
  serialNumber?: string;
  notes?: string;
  roomName?: string | null;
  location?: string;
  condition?: string;
};

/** Lowercase, strip punctuation, collapse spaces. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The text of one item, as one searchable string. */
function haystack(item: SearchableItem): string {
  return normalise(
    [
      item.name,
      item.category,
      item.serialNumber,
      item.notes,
      item.roomName ?? "",
      item.location,
      item.condition,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Does this item match what was typed?
 *
 * Every word has to appear, in any order and anywhere in the item's text.
 * That is what makes "1073 neve" and "neve 1073" both work, and it is why
 * this is not a substring test on the concatenated string.
 */
export function matchesSearch(item: SearchableItem, query: string): boolean {
  const terms = normalise(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(item);
  return terms.every((term) => text.includes(term));
}

/** Filter a list, preserving its order. */
export function searchItems<T extends SearchableItem>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  return items.filter((item) => matchesSearch(item, query));
}
