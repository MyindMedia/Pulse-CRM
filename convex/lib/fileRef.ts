import { v } from "convex/values";

/** A stored file: a legacy Convex storage id, or an R2 mediaFiles id. Fields and
 *  mutation args that point at a file use this so old rows keep working while new
 *  uploads go to Cloudflare R2. Read with fileUrl() from lib/media. */
export const fileRefV = v.union(v.id("_storage"), v.id("mediaFiles"));
