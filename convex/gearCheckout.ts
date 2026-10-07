import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";
import { orgHasFeature } from "./lib/entitlements";
import { generateCode, isOverdue, isValidCode, normalizeCode } from "./lib/gearCode";

/* ============================================================
   Gear check-out. Scan a label, hand the gear to a person, a
   session or a rental, and keep the history on the item.

   Studio isolation: the org comes from auth on every call and a
   code is only ever looked up inside that org. A code that
   belongs to another studio reads exactly like a code that does
   not exist, so a scan can never reveal that it exists elsewhere.
   ============================================================ */

const GATE = { entitlement: "gearCheckout" } as const;
const NOT_FOUND = "No gear found for that code";

const holderV = v.object({
  kind: v.union(v.literal("member"), v.literal("client"), v.literal("session"), v.literal("rental")),
  memberId: v.optional(v.id("members")),
  artistId: v.optional(v.id("artists")),
  sessionId: v.optional(v.id("sessions")),
  /** Required for a rental (who is renting); optional otherwise. */
  label: v.optional(v.string()),
});

const readOrg = (ctx: QueryCtx | MutationCtx) =>
  currentOrgWithCapability(ctx, "equipment.read", undefined, GATE);
const editOrg = (ctx: QueryCtx | MutationCtx) =>
  currentOrgWithCapability(ctx, "equipment.edit", undefined, GATE);

async function byCode(ctx: QueryCtx | MutationCtx, orgId: string, raw: string) {
  const code = normalizeCode(raw);
  if (!code) return null;
  return ctx.db
    .query("equipment")
    .withIndex("by_org_barcode", (q) => q.eq("orgId", orgId).eq("barcode", code))
    .first();
}

async function openFor(ctx: QueryCtx | MutationCtx, equipmentId: Id<"equipment">) {
  return ctx.db
    .query("gearCheckouts")
    .withIndex("by_equipment_open", (q) => q.eq("equipmentId", equipmentId).eq("inAt", undefined))
    .first();
}

async function resolveItem(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  args: { code?: string; equipmentId?: Id<"equipment"> },
): Promise<Doc<"equipment">> {
  let item: Doc<"equipment"> | null = null;
  if (args.code !== undefined) item = await byCode(ctx, orgId, args.code);
  else if (args.equipmentId) item = await ctx.db.get(args.equipmentId);
  if (!item || item.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: NOT_FOUND });
  return item;
}

async function uniqueCode(ctx: MutationCtx, orgId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const c = generateCode();
    if (!(await byCode(ctx, orgId, c))) return c;
  }
  throw new ConvexError({ code: "CODE_EXHAUSTED", message: "Could not generate a free code" });
}

async function resolveHolder(
  ctx: MutationCtx,
  orgId: string,
  h: { kind: "member" | "client" | "session" | "rental"; memberId?: Id<"members">; artistId?: Id<"artists">; sessionId?: Id<"sessions">; label?: string },
) {
  const bad = (m: string) => new ConvexError({ code: "BAD_HOLDER", message: m });
  if (h.kind === "member") {
    const m = h.memberId ? await ctx.db.get(h.memberId) : null;
    if (!m || m.orgId !== orgId) throw bad("Pick a team member");
    return { holderMemberId: m._id, holderLabel: m.name };
  }
  if (h.kind === "client") {
    const a = h.artistId ? await ctx.db.get(h.artistId) : null;
    if (!a || a.orgId !== orgId) throw bad("Pick a client");
    return { holderArtistId: a._id, holderLabel: a.name };
  }
  if (h.kind === "session") {
    const s = h.sessionId ? await ctx.db.get(h.sessionId) : null;
    if (!s || s.orgId !== orgId) throw bad("Pick a session");
    return { holderSessionId: s._id, holderLabel: s.title };
  }
  const label = h.label?.trim();
  if (!label) throw bad("Name who is renting it");
  const artist = h.artistId ? await ctx.db.get(h.artistId) : null;
  return { ...(artist && artist.orgId === orgId ? { holderArtistId: artist._id } : {}), holderLabel: label };
}

function shape(c: Doc<"gearCheckouts">, now: number) {
  return { ...c, overdue: isOverdue(c, now) };
}

/** What a scan shows: the item, its code, and who has it right now. */
export const lookup = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const orgId = await readOrg(ctx);
    const item = await byCode(ctx, orgId, code);
    if (!item) return null; // another studio's code looks the same as no code
    const open = await openFor(ctx, item._id);
    return {
      equipmentId: item._id,
      name: item.name,
      category: item.category,
      barcode: item.barcode ?? null,
      status: item.status,
      out: open ? shape(open, Date.now()) : null,
    };
  },
});

/** Give an item a label code: the one supplied, or a generated one. */
export const assignCode = mutation({
  args: { equipmentId: v.id("equipment"), code: v.optional(v.string()) },
  handler: async (ctx, { equipmentId, code }) => {
    const orgId = await editOrg(ctx);
    const item = await ctx.db.get(equipmentId);
    if (!item || item.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: NOT_FOUND });
    let next: string;
    if (code !== undefined && code.trim() !== "") {
      next = normalizeCode(code);
      if (!isValidCode(next)) {
        throw new ConvexError({ code: "BAD_CODE", message: "Use 3 to 32 letters, digits or dashes" });
      }
      const clash = await byCode(ctx, orgId, next);
      if (clash && clash._id !== equipmentId) {
        throw new ConvexError({ code: "CODE_TAKEN", message: "That code is already on other gear" });
      }
    } else {
      if (item.barcode) return item.barcode;
      next = await uniqueCode(ctx, orgId);
    }
    await ctx.db.patch(equipmentId, { barcode: next });
    return next;
  },
});

/** Generate codes for every item that has none, so a label sheet covers everything. */
export const assignMissingCodes = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await editOrg(ctx);
    const rows = await ctx.db.query("equipment").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    let assigned = 0;
    for (const r of rows) {
      if (r.barcode || r.status === "retired") continue;
      await ctx.db.patch(r._id, { barcode: await uniqueCode(ctx, orgId) });
      assigned++;
    }
    return { assigned };
  },
});

/** Items for the label sheet (only those with a code). */
export const labels = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await readOrg(ctx);
    const rows = await ctx.db.query("equipment").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows
      .filter((r) => r.barcode && r.status !== "retired")
      .map((r) => ({ equipmentId: r._id, name: r.name, category: r.category, barcode: r.barcode as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const checkOut = mutation({
  args: {
    code: v.optional(v.string()),
    equipmentId: v.optional(v.id("equipment")),
    holder: holderV,
    dueAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await editOrg(ctx);
    const item = await resolveItem(ctx, orgId, args);
    if (item.status === "retired" || item.status === "maintenance") {
      throw new ConvexError({ code: "NOT_AVAILABLE", message: `${item.name} is ${item.status === "retired" ? "retired" : "in maintenance"}` });
    }
    const open = await openFor(ctx, item._id);
    if (open) {
      throw new ConvexError({ code: "ALREADY_OUT", message: `${item.name} is already checked out to ${open.holderLabel}` });
    }
    const now = Date.now();
    if (args.dueAt !== undefined && args.dueAt <= now) {
      throw new ConvexError({ code: "BAD_DUE", message: "The due time must be in the future" });
    }
    const who = await resolveHolder(ctx, orgId, args.holder);
    const identity = await ctx.auth.getUserIdentity();
    const id = await ctx.db.insert("gearCheckouts", {
      orgId,
      equipmentId: item._id,
      equipmentName: item.name,
      ...(item.barcode ? { barcode: item.barcode } : {}),
      holderKind: args.holder.kind,
      ...who,
      outAt: now,
      ...(args.dueAt !== undefined ? { dueAt: args.dueAt } : {}),
      ...(args.notes?.trim() ? { notes: args.notes.trim() } : {}),
      outBy: await currentActor(ctx),
      ...(identity?.subject ? { outByClerkUserId: identity.subject } : {}),
    });
    await ctx.db.patch(item._id, { status: "in_use" });
    await ctx.db.insert("activity", {
      orgId,
      kind: "gear.checked_out",
      summary: `${item.name} checked out to ${who.holderLabel}`,
      entityType: "equipment",
      entityId: item._id,
      accent: "info",
    });
    return { checkoutId: id, equipmentId: item._id, name: item.name };
  },
});

export const checkIn = mutation({
  args: {
    code: v.optional(v.string()),
    equipmentId: v.optional(v.id("equipment")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await editOrg(ctx);
    const item = await resolveItem(ctx, orgId, args);
    const open = await openFor(ctx, item._id);
    if (!open || open.orgId !== orgId) {
      throw new ConvexError({ code: "NOT_OUT", message: `${item.name} is not checked out` });
    }
    const now = Date.now();
    await ctx.db.patch(open._id, {
      inAt: now,
      inBy: await currentActor(ctx),
      ...(args.notes?.trim() ? { returnNotes: args.notes.trim() } : {}),
    });
    await ctx.db.patch(item._id, { status: "available" });
    await ctx.db.insert("activity", {
      orgId,
      kind: "gear.checked_in",
      summary: `${item.name} returned by ${open.holderLabel}`,
      entityType: "equipment",
      entityId: item._id,
      accent: "positive",
    });
    return { checkoutId: open._id, equipmentId: item._id, name: item.name, wasOverdue: isOverdue(open, now) };
  },
});

/** Who has what right now, overdue first. */
export const listOut = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await readOrg(ctx);
    const rows = await ctx.db
      .query("gearCheckouts")
      .withIndex("by_org_open", (q) => q.eq("orgId", orgId).eq("inAt", undefined))
      .collect();
    const now = Date.now();
    return rows
      .map((r) => shape(r, now))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.outAt - b.outAt);
  },
});

/** Only the overdue ones. */
export const overdue = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await readOrg(ctx);
    const rows = await ctx.db
      .query("gearCheckouts")
      .withIndex("by_org_open", (q) => q.eq("orgId", orgId).eq("inAt", undefined))
      .collect();
    const now = Date.now();
    return rows.filter((r) => isOverdue(r, now)).map((r) => shape(r, now)).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  },
});

/** Every time one item went out, newest first. */
export const history = query({
  args: { equipmentId: v.id("equipment"), limit: v.optional(v.number()) },
  handler: async (ctx, { equipmentId, limit }) => {
    const orgId = await readOrg(ctx);
    const item = await ctx.db.get(equipmentId);
    if (!item || item.orgId !== orgId) return [];
    const rows = await ctx.db
      .query("gearCheckouts")
      .withIndex("by_equipment", (q) => q.eq("equipmentId", equipmentId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 200));
    const now = Date.now();
    return rows.filter((r) => r.orgId === orgId).map((r) => shape(r, now));
  },
});

/** Cron: tell the studio (and the holder, when it is a team member) once per
 *  overdue check-out. Goes through notify.toOrg, so web and iPhone both hear it. */
export const sweepOverdue = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const now = nowMs ?? Date.now();
    // Walk the open, un-alerted check-outs whose due time has passed, oldest
    // first, straight off the index: not-yet-due rows are never read, so they
    // cannot crowd out an overdue one. Every row handled gets overdueNotifiedAt
    // stamped, which drops it from the range, so a studio below Growth cannot
    // starve newer overdue rows either. (A studio that upgrades later does not
    // get an alert for check-outs that went overdue while it was below Growth.)
    const PAGE = 200;
    const MAX_PAGES = 25;
    const entitled = new Map<string, boolean>();
    let notified = 0;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await ctx.db
        .query("gearCheckouts")
        .withIndex("by_open_due", (q) =>
          q.eq("inAt", undefined).eq("overdueNotifiedAt", undefined).gte("dueAt", 0).lte("dueAt", now),
        )
        .paginate({ numItems: PAGE, cursor });
      for (const r of res.page) {
        if (!isOverdue(r, now)) continue;
        let ok = entitled.get(r.orgId);
        if (ok === undefined) {
          ok = await orgHasFeature(ctx, r.orgId, "gearCheckout");
          entitled.set(r.orgId, ok);
        }
        // Studios that dropped below Growth stop getting the alert; mark the row
        // so it never gets re-read.
        if (!ok) {
          await ctx.db.patch(r._id, { overdueNotifiedAt: now });
          continue;
        }
        const holder = r.holderMemberId ? await ctx.db.get(r.holderMemberId) : null;
        await ctx.db.patch(r._id, { overdueNotifiedAt: now });
        await ctx.scheduler.runAfter(0, internal.notify.toOrg, {
          orgId: r.orgId,
          title: "Gear is overdue",
          body: `${r.equipmentName} was due back from ${r.holderLabel}.`,
          url: "/inventory",
          tag: `gear-overdue-${r._id}`,
          ...(holder?.clerkUserId ? { clerkUserIds: [holder.clerkUserId] } : {}),
        });
        notified++;
      }
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    return { notified };
  },
});
