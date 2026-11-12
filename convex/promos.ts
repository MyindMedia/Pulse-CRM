import { query, internalQuery } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";
import { isSweepMadeLegacyCode } from "./lib/rateCutCodes";

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
  // A promo row with this code that is switched off, declined or still
  // waiting for approval never falls through to a legacy code of the same
  // name either: switching a promo off must switch the code off.
  const anyPromo = await ctx.db
    .query("promos")
    .withIndex("by_org_code", (q) => q.eq("orgId", org.orgId).eq("code", code))
    .first();
  if (anyPromo) return null;
  // Permanent codes the old weekly sweep wrote without anyone approving them
  // are no longer accepted (truth-discount-codes).
  if (isSweepMadeLegacyCode(legacy)) return null;
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
    const code = normalizeCode(args.code);
    const dup = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", orgId).eq("code", code)).filter((q) => q.eq(q.field("active"), true)).first();
    if (dup && dup._id !== id) throw new Error(`Code ${code} is already active. Deactivate it first or pick another code.`);
    await ctx.db.patch(id, { ...args, code, pct: Math.round(args.pct) });
  },
});

export const deactivate = mutation({
  args: { id: v.id("promos") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const p = await ctx.db.get(id);
    if (!p || p.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { active: false, awaitingApproval: false });
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
 *  window is refreshed, not duplicated. With `awaitingApproval`, the promo is
 *  created switched OFF and goes live only when a person approves it
 *  (approvePost for its draft post, or `activate` on the Promos screen). */
export const createInternal = internalMutation({
  args: {
    orgId: v.string(), ...promoArgs, source: v.union(v.literal("owner"), v.literal("rate_cut")),
    awaitingApproval: v.optional(v.boolean()),
  },
  handler: async (ctx, { awaitingApproval, ...args }) => {
    validate(args);
    const code = normalizeCode(args.code);
    if (awaitingApproval) {
      const waiting = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", args.orgId).eq("code", code))
        .filter((q) => q.eq(q.field("awaitingApproval"), true)).first();
      if (waiting) return waiting._id;
      return await ctx.db.insert("promos", {
        orgId: args.orgId, code, pct: args.pct, label: args.label, startsAt: args.startsAt, endsAt: args.endsAt,
        roomId: args.roomId, maxRedemptions: args.maxRedemptions, redemptions: 0,
        source: args.source, active: false, awaitingApproval: true, createdBy: "pulse-ai", createdAt: Date.now(),
      });
    }
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

/** Turn a promo that is waiting for approval on. Only ever acts on a row of
 *  `orgId` that is still waiting: a promo the owner switched off or declined
 *  stays off, and a second call (double click) changes nothing. */
export async function activateWaitingPromo(
  ctx: MutationCtx,
  orgId: string,
  promoId: Id<"promos">,
  actor: string,
): Promise<"activated" | "already_active" | "not_waiting"> {
  const p = await ctx.db.get(promoId);
  if (!p || p.orgId !== orgId) throw new Error("Not found");
  if (p.active) return "already_active";
  if (!p.awaitingApproval) return "not_waiting";
  if (p.endsAt <= Date.now()) throw new Error(`Promo ${p.code} has already ended. Create a new promo instead.`);
  const clash = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", orgId).eq("code", p.code))
    .filter((q) => q.eq(q.field("active"), true)).first();
  if (clash) throw new Error(`Code ${p.code} is already active.`);
  await ctx.db.patch(promoId, { active: true, awaitingApproval: false, approvedBy: actor, approvedAt: Date.now() });
  return "activated";
}

/** The owner approves a suggested promo from the Promos screen. */
export const activate = mutation({
  args: { id: v.id("promos") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    return await activateWaitingPromo(ctx, orgId, id, await currentActor(ctx));
  },
});

/** Declining a suggested promo: it stays off and stops waiting. */
export async function declineWaitingPromo(ctx: MutationCtx, orgId: string, promoId: Id<"promos">) {
  const p = await ctx.db.get(promoId);
  if (!p || p.orgId !== orgId || !p.awaitingApproval) return;
  await ctx.db.patch(promoId, { awaitingApproval: false, active: false });
}

export async function recordRedemption(ctx: MutationCtx, promoId: Id<"promos">) {
  const p = await ctx.db.get(promoId);
  if (p) await ctx.db.patch(promoId, { redemptions: p.redemptions + 1 });
}

/** REPORT ONLY, changes nothing (truth-discount-codes, one-time correction).
 *  Lists, one page of studios at a time, what the old weekly sweep left
 *  behind so the owner can decide what to switch off and whom to tell:
 *    - permanent codes it wrote into orgs.discountCodes (checkout already
 *      refuses these; switching them off in settings is the cleanup);
 *    - rate-cut promos that are live but were never approved by a person
 *      (made before this change, active from the moment they were created).
 *  Run from the Convex dashboard: promos:reportSweepCodes, then pass the
 *  returned cursor until isDone. */
export const reportSweepCodes = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db.query("orgs").paginate({ cursor: cursor ?? null, numItems: Math.min(numItems ?? 50, 200) });
    const studios = [];
    for (const org of page.page) {
      const promos = await ctx.db.query("promos").withIndex("by_org", (q) => q.eq("orgId", org.orgId)).collect();
      const rateCutCodes = new Set(promos.filter((p) => p.source === "rate_cut").map((p) => p.code));
      const legacy = (org.discountCodes ?? [])
        .filter((c) => isSweepMadeLegacyCode(c) || rateCutCodes.has(normalizeCode(c.code)))
        .map((c) => ({ code: c.code, pct: c.pct, label: c.label ?? null, active: c.active }));
      const unapprovedLivePromos = promos
        .filter((p) => p.source === "rate_cut" && p.active && !p.approvedAt)
        .map((p) => ({ promoId: p._id, code: p.code, pct: p.pct, label: p.label ?? null, endsAt: p.endsAt, redemptions: p.redemptions }));
      if (legacy.length || unapprovedLivePromos.length) {
        studios.push({ orgId: org.orgId, name: org.name, sweepPermanentCodes: legacy, unapprovedLivePromos });
      }
    }
    return { studios, cursor: page.continueCursor, isDone: page.isDone };
  },
});
