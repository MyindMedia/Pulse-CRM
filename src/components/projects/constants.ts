export const STAGE_LABEL: Record<string, string> = {
  tracking: "Tracking",
  editing: "Editing",
  mixing: "Mixing",
  mastering: "Mastering",
  delivery: "Delivery",
  complete: "Complete",
};

export const LINK_KIND_LABEL: Record<string, string> = {
  session: "Session",
  song: "Song",
  room: "Room",
  engineer: "Engineer",
  invoice: "Bill",
  deliverable: "Deliverable",
  opportunity: "Job",
  artist: "Client",
};

/** Kinds the link picker can list (the rest are linked from their own pages). */
export const PICKABLE_KINDS = ["song", "session", "room", "engineer", "invoice"] as const;

/** ms epoch -> value for <input type="date"> in local time. */
export function toDateInput(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** <input type="date"> value -> ms epoch at 5pm local, or null when blank. */
export function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 17, 0, 0, 0).getTime();
}
