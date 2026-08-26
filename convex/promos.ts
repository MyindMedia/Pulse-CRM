import { mutation, query, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";

export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

/** Resolve a submitted code for checkout: an active Promo whose window
 *  contains `now`, whose room matches (or is unscoped) and which is under its
 *  cap wins; otherwise the legacy orgs.discountCodes entry. Never returns a
 *  list. */
export async function resolveCode(
  ctx: QueryCtx | MutationCtx,
  org: Doc<"orgs"> | null,
  raw: string | undefined,
  roomId: Id<"rooms"> | undefined,
  now: number,
): Promise<{ code: string; pct: number; label: string | null; promoId?: Id<"promos">; expiresAt?: number } | null> {
  const code = raw ? normalizeCode(raw) : "";
  if (!code || !org) return null;
  const promo = await ctx.db
    .query("promos")
    .withIndex("by_org_code", (q) => q.eq("orgId", org.orgId).eq("code", code))
    .filter((q) => q.eq(q.field("active"), true))
    .first();
  if (promo) {
    const inWindow = promo.startsAt <= now && now <= promo.endsAt;
    const roomOk = !promo.roomId || !roomId || promo.roomId === roomId;
    const underCap = promo.maxRedemptions === undefined || promo.redemptions < promo.maxRedemptions;
    if (inWindow && roomOk && underCap) {
      const pct = Math.min(Math.max(promo.pct, 0), 100);
      return { code: promo.code, pct, label: promo.label ?? null, promoId: promo._id, expiresAt: promo.endsAt };
    }
    return null; // a matching but inactive-by-rule promo never falls through to a legacy code of the same name
  }
  const legacy = (org.discountCodes ?? []).find((c) => c.code === code && c.active);
  if (!legacy) return null;
  return { code: legacy.code, pct: Math.min(Math.max(legacy.pct, 0), 100), label: legacy.label ?? null };
}

const promoArgs = {
  code: v.string(),
  pct: v.number(),
  label: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  roomId: v.optional(v.id("rooms")),
  maxRedemptions: v.optional(v.number()),
};

function validate(a: { code: string; pct: number; startsAt: number; endsAt: number }) {
  if (!normalizeCode(a.code)) throw new Error("Enter a code.");
  if (a.pct < 1 || a.pct > 90) throw new Error("Discount must be between 1 and 90 percent.");
  if (a.endsAt <= a.startsAt) throw new Error("The promo has to end after it starts.");
}

export const create = mutation({
  args: promoArgs,
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    validate(args);
    const code = normalizeCode(args.code);
    const dup = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", orgId).eq("code", code)).filter((q) => q.eq(q.field("active"), true)).first();
    if (dup) throw new Error(`Code ${code} is already active. Deactivate it first or pick another code.`);
    const actor = await currentActor(ctx);
    return await ctx.db.insert("promos", {
      orgId, code, pct: Math.round(args.pct), label: args.label, startsAt: args.startsAt, endsAt: args.endsAt,
      roomId: args.roomId, maxRedemptions: args.maxRedemptions, redemptions: 0,
      source: "owner", active: true, createdBy: actor, createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { id: v.id("promos"), ...promoArgs },
  handler: async (ctx, { id, ...args }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const p = await ctx.db.get(id);
    if (!p || p.orgId !== orgId) throw new Error("Not found");
    validate(args);
    await ctx.db.patch(id, { ...args, code: normalizeCode(args.code), pct: Math.round(args.pct) });
  },
});

export const deactivate = mutation({
  args: { id: v.id("promos") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const p = await ctx.db.get(id);
    if (!p || p.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { active: false });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("promos").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** AI / cron path: create or refresh a rate-cut promo. Same code twice in a
 *  window is refreshed, not duplicated. */
export const createInternal = internalMutation({
  args: { orgId: v.string(), ...promoArgs, source: v.union(v.literal("owner"), v.literal("rate_cut")) },
  handler: async (ctx, args) => {
    const code = normalizeCode(args.code);
    const existing = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", args.orgId).eq("code", code)).filter((q) => q.eq(q.field("active"), true)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { pct: args.pct, startsAt: args.startsAt, endsAt: args.endsAt, roomId: args.roomId, label: args.label });
      return existing._id;
    }
    return await ctx.db.insert("promos", {
      orgId: args.orgId, code, pct: args.pct, label: args.label, startsAt: args.startsAt, endsAt: args.endsAt,
      roomId: args.roomId, maxRedemptions: args.maxRedemptions, redemptions: 0,
      source: args.source, active: true, createdBy: "pulse-ai", createdAt: Date.now(),
    });
  },
});

export async function recordRedemption(ctx: MutationCtx, promoId: Id<"promos">) {
  const p = await ctx.db.get(promoId);
  if (p) await ctx.db.patch(promoId, { redemptions: p.redemptions + 1 });
}
