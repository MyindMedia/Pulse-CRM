import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { resolveConvexUrl } from "@/lib/convex-url";

/** Public, unauthenticated Convex reads for server-rendered pages. */
export function publicConvex(): ConvexHttpClient {
  return new ConvexHttpClient(resolveConvexUrl());
}
