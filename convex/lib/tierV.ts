import { v } from "convex/values";

/** The three plan keys as a Convex validator. Use this for every argument or
 *  field that holds a plan, so the ladder is spelled once (lib/pricing.ts). */
export const tierV = v.union(v.literal("core"), v.literal("growth"), v.literal("max"));

export const intervalV = v.union(v.literal("month"), v.literal("year"));
