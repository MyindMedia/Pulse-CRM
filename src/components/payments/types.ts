import type { Id } from "@convex/_generated/dataModel";

/** A single billable line on an invoice - money stored in integer cents. */
export type LineItem = { label: string; amountCents: number };

/** Invoice status values mirrored from the Convex schema. */
export type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "void";

/** A row as returned by `api.invoices.list` - invoice + hydrated artist
 * name + derived category for the table. */
export type InvoiceRow = {
  _id: Id<"invoices">;
  _creationTime: number;
  number: string;
  artistId: Id<"artists">;
  songId?: Id<"songs">;
  sessionId?: Id<"sessions">;
  status: InvoiceStatus;
  lineItems: LineItem[];
  amountCents: number;
  dueDate: number;
  paidAt?: number;
  artistName: string;
  category: string;
};

/** Artist shape inside a hydrated invoice (subset of the artists table). */
export type InvoiceArtist = {
  _id: Id<"artists">;
  name: string;
  email?: string;
  type: string;
  avatarColor?: string;
};

/** A full invoice as returned by `api.invoices.get`. */
export type InvoiceDetail = {
  _id: Id<"invoices">;
  _creationTime: number;
  number: string;
  artistId: Id<"artists">;
  songId?: Id<"songs">;
  sessionId?: Id<"sessions">;
  status: InvoiceStatus;
  lineItems: LineItem[];
  amountCents: number;
  dueDate: number;
  paidAt?: number;
  artist: InvoiceArtist | null;
  songTitle: string | null;
  sessionTitle: string | null;
  serviceType: string | null;
  category: string;
};

/** An activity row scoped to an invoice. */
export type ActivityRow = {
  _id: string;
  _creationTime: number;
  kind: string;
  summary: string;
  accent?: "gold" | "positive" | "critical" | "info";
};

/** A roster entry from `api.artists.roster`. */
export type RosterEntry = {
  _id: Id<"artists">;
  name: string;
  type: string;
  avatarColor?: string;
};

/** A song option from `api.songs.picker`. */
export type SongOption = {
  _id: Id<"songs">;
  title: string;
  stage: string;
};

/** True when an invoice is past its due date and still unpaid. */
export function isOverdue(status: InvoiceStatus): boolean {
  return status === "overdue";
}
