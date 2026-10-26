import "server-only";
import { api } from "@convex/_generated/api";
import { publicConvex } from "@/lib/convex-server";
import type { DirectoryForLlms } from "@/lib/llms";

/** Listed Studios and City Pages for the sitemap and llms.txt. Null when
 *  Convex is unreachable, so those files still serve their static part. */
export async function directoryFeed(): Promise<DirectoryForLlms | null> {
  try {
    return await publicConvex().query(api.directory.sitemapEntries, {});
  } catch {
    return null;
  }
}
