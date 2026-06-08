import { ConvexError } from "convex/values";

/** Extract a user-facing message from an error, preferring a ConvexError's
 *  structured `data.message` (e.g. plan-limit LIMIT_REACHED messages), then a
 *  plain Error message, then the fallback. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ConvexError) {
    const d = err.data as { message?: string } | string | undefined;
    if (typeof d === "string" && d.trim()) return d;
    if (d && typeof d === "object" && typeof d.message === "string" && d.message.trim()) return d.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
