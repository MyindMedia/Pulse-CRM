/** Composes the brand card's subline (the smaller line under the headline)
 *  from whatever candidate phrases apply to this card - typically a room
 *  name and a promo's own free-text label. A naive `.join(", ")` of those
 *  two produced a broken card whenever a studio's promo label already named
 *  the room it applies to: room "Studio A - Live Room" plus label
 *  "Studio A, Tuesday evenings" rendered literally as
 *  "Studio A - Live Room, Studio A, Tuesday evenings" on a real studio's
 *  Instagram and Facebook.
 *
 *  A studio owner typing a promo label will very often repeat the room name
 *  (it reads naturally to them - "Studio A, Tuesday evenings" describes the
 *  promo, not the card), so this has to handle the general case: any
 *  comma-separated segment that already appears, whole-word, inside another
 *  segment is dropped rather than repeated. Between two segments where one
 *  contains the other, the richer (longer) text wins regardless of which
 *  part it came from, so the composed line never loses information by
 *  accident of ordering. */
export function composeSubline(parts: Array<string | null | undefined>): string {
  const segments: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.split(",")) {
      const seg = raw.trim();
      if (!seg) continue;
      addSegment(segments, seg);
    }
  }
  return segments.join(", ");
}

function addSegment(segments: string[], seg: string): void {
  const norm = normalize(seg);
  for (let i = 0; i < segments.length; i++) {
    const existingNorm = normalize(segments[i]);
    if (existingNorm === norm) return; // exact duplicate, nothing to add
    if (containsWhole(norm, existingNorm)) {
      segments[i] = seg; // the new segment is the richer of the two
      return;
    }
    if (containsWhole(existingNorm, norm)) return; // already covered, and richer
  }
  segments.push(seg);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Whether `needle` appears inside `haystack` on word boundaries, so
 *  "Studio A" is found inside "Studio A - Live Room" but not inside
 *  "Studio Anytime Deals" - a plain substring test would wrongly flag the
 *  latter as a repeat of the former. */
function containsWhole(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`).test(haystack);
}
