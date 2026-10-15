import { query, internalQuery, internalAction, type QueryCtx, type MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { resolveViewer, AccessError } from "./lib/access";
import { platformAgencyId } from "./lib/platformAgency";
import { sendEmail } from "./lib/email";
import { escapeHtml } from "./lib/text";
import {
  FEATURE_STATUSES,
  FEATURE_CATEGORIES,
  TITLE_MIN,
  TITLE_MAX,
  DESCRIPTION_MAX,
  DAILY_SUBMIT_LIMIT,
  overlapScore,
  type FeatureStatus,
} from "./lib/featureRequests";

/* ============================================================
   Feature requests - one platform-wide board.

   Any signed-in member of any studio can read the board, file a request
   and vote once per request. Only the platform owner (the Pulse agency's
   owner or an admin) can change a status, edit or merge, and only the
   platform owner ever sees who asked. Other studios get the idea, never
   the studio or the person behind it.
   ============================================================ */

const statusV = v.union(
  v.literal("pending"),
  v.literal("in_the_works"),
  v.literal("beta"),
  v.literal("q1"),
  v.literal("q2"),
  v.literal("q3"),
  v.literal("q4"),
  v.literal("shipped"),
  v.literal("declined"),
);

type Ctx = QueryCtx | MutationCtx;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOARD_CAP = 500;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** The signed-in caller, or null when not signed in. Never throws. */
async function viewerOrNull(ctx: Ctx) {
  try {
    const viewer = await resolveViewer(ctx);
    // A guest link is not a signed-in person: no board for them.
    return viewer.kind === "guest" ? null : viewer;
  } catch (e) {
    if (e instanceof AccessError) return null;
    throw e;
  }
}

/** The platform owner: an owner or admin of the Pulse agency. Local demo mode
 *  (Clerk off) counts, exactly as `agency.access` admits it. */
async function isPlatformAdmin(ctx: Ctx, viewer: NonNullable<Awaited<ReturnType<typeof viewerOrNull>>>) {
  if (viewer.kind === "agency_member") {
    const pulse = await platformAgencyId(ctx);
    if (pulse && viewer.agencyId !== pulse) return false;
    return viewer.role === "owner" || viewer.role === "admin";
  }
  if (viewer.kind === "studio_member" && viewer.clerkUserId === "demo-user") {
    const identity = await ctx.auth.getUserIdentity();
    return !identity;
  }
  return false;
}

async function requireAdmin(ctx: Ctx) {
  const viewer = await viewerOrNull(ctx);
  if (!viewer) fail("UNAUTHENTICATED", "Sign in required.");
  if (!(await isPlatformAdmin(ctx, viewer))) {
    fail("CAPABILITY_DENIED", "Only the platform owner can do that.");
  }
  return viewer;
}

async function votedSet(ctx: Ctx, clerkUserId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .query("featureRequestVotes")
    .withIndex("by_voter", (q) => q.eq("voterClerkId", clerkUserId))
    .take(2000);
  return new Set(rows.map((r) => r.requestId as string));
}

/** What every studio may see about a request. No requester fields, ever. */
function publicRow(r: Doc<"featureRequests">, voted: Set<string>, mine: boolean) {
  return {
    _id: r._id,
    title: r.title,
    description: r.description ?? null,
    category: r.category ?? null,
    status: r.status as FeatureStatus,
    votes: r.votes,
    createdAt: r.createdAt,
    voted: voted.has(r._id as string),
    mine,
  };
}

function boardSort(a: Doc<"featureRequests">, b: Doc<"featureRequests">) {
  return b.votes - a.votes || b.createdAt - a.createdAt;
}

/** The board: every visible request, most votes first, then newest. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return [];
    const rows = (await ctx.db.query("featureRequests").withIndex("by_votes").order("desc").take(BOARD_CAP))
      .filter((r) => !r.mergedInto)
      .sort(boardSort);
    const voted = await votedSet(ctx, viewer.clerkUserId ?? "");
    return rows.map((r) => publicRow(r, voted, r.requesterClerkId === viewer.clerkUserId));
  },
});

/** Live duplicate suggestions while a title is typed. */
export const similar = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const viewer = await viewerOrNull(ctx);
    const q = text.trim().slice(0, TITLE_MAX);
    if (!viewer || q.length < 2) return [];
    const found = new Map<string, { row: Doc<"featureRequests">; score: number }>();
    const consider = (r: Doc<"featureRequests">) => {
      if (r.mergedInto) return;
      const score = overlapScore(q, r.title);
      if (score <= 0) return;
      const prev = found.get(r._id as string);
      if (!prev || prev.score < score) found.set(r._id as string, { row: r, score });
    };
    // Convex full text search on the title, then the plain word-overlap pass
    // over the most voted rows, so a typo-free partial word still lands.
    const hits = await ctx.db
      .query("featureRequests")
      .withSearchIndex("search_title", (s) => s.search("title", q))
      .take(8);
    hits.forEach((r) => {
      if (r.mergedInto) return;
      const score = Math.max(overlapScore(q, r.title), 0.34);
      found.set(r._id as string, { row: r, score });
    });
    (await ctx.db.query("featureRequests").withIndex("by_votes").order("desc").take(300)).forEach(consider);
    const voted = await votedSet(ctx, viewer.clerkUserId ?? "");
    return [...found.values()]
      .sort((a, b) => b.score - a.score || b.row.votes - a.row.votes)
      .slice(0, 5)
      .map(({ row }) => publicRow(row, voted, row.requesterClerkId === viewer.clerkUserId));
  },
});

/** Add or remove one vote. Idempotent: asking for the state you are already
 *  in changes nothing. */
async function applyVote(ctx: MutationCtx, requestId: Id<"featureRequests">, want: boolean) {
  const viewer = await viewerOrNull(ctx);
  if (!viewer || !viewer.clerkUserId) fail("UNAUTHENTICATED", "Sign in required.");
  const req = await ctx.db.get(requestId);
  if (!req || req.mergedInto) fail("NOT_FOUND", "That request is no longer on the board.");
  const existing = await ctx.db
    .query("featureRequestVotes")
    .withIndex("by_request_voter", (q) => q.eq("requestId", requestId).eq("voterClerkId", viewer.clerkUserId))
    .first();
  let votes = req.votes;
  if (want && !existing) {
    await ctx.db.insert("featureRequestVotes", {
      requestId,
      voterClerkId: viewer.clerkUserId,
      voterOrgId: "orgId" in viewer && viewer.orgId ? viewer.orgId : "pulse-agency",
      createdAt: Date.now(),
    });
    votes += 1;
  } else if (!want && existing) {
    await ctx.db.delete(existing._id);
    votes = Math.max(0, votes - 1);
  }
  if (votes !== req.votes) await ctx.db.patch(requestId, { votes });
  return { voted: want, votes };
}

export const setVote = mutation({
  args: { requestId: v.id("featureRequests"), voted: v.boolean() },
  handler: async (ctx, { requestId, voted }) => applyVote(ctx, requestId, voted),
});

/** One tap: vote if you have not, remove the vote if you have. */
export const toggleVote = mutation({
  args: { requestId: v.id("featureRequests") },
  handler: async (ctx, { requestId }) => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer || !viewer.clerkUserId) fail("UNAUTHENTICATED", "Sign in required.");
    const existing = await ctx.db
      .query("featureRequestVotes")
      .withIndex("by_request_voter", (q) => q.eq("requestId", requestId).eq("voterClerkId", viewer.clerkUserId))
      .first();
    return applyVote(ctx, requestId, !existing);
  },
});

function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < TITLE_MIN) fail("INVALID", `Give the request a title of at least ${TITLE_MIN} characters.`);
  if (t.length > TITLE_MAX) fail("INVALID", `Keep the title under ${TITLE_MAX} characters.`);
  return t;
}
function cleanDescription(raw: string | undefined): string | undefined {
  const d = (raw ?? "").trim();
  if (d.length > DESCRIPTION_MAX) fail("INVALID", `Keep the description under ${DESCRIPTION_MAX} characters.`);
  return d || undefined;
}
function cleanCategory(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!(FEATURE_CATEGORIES as readonly string[]).includes(raw)) fail("INVALID", "Pick a category from the list.");
  return raw;
}

/** File a new request. Auto-votes for the submitter, notifies the platform
 *  owner in app, and queues the owner email. */
export const submit = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer || !viewer.clerkUserId) fail("UNAUTHENTICATED", "Sign in required.");
    const title = cleanTitle(args.title);
    const description = cleanDescription(args.description);
    const category = cleanCategory(args.category);
    const now = Date.now();

    const recent = await ctx.db
      .query("featureRequests")
      .withIndex("by_requester_created", (q) =>
        q.eq("requesterClerkId", viewer.clerkUserId).gt("createdAt", now - DAY_MS))
      .take(DAILY_SUBMIT_LIMIT);
    if (recent.length >= DAILY_SUBMIT_LIMIT) {
      fail("RATE_LIMITED", `You can post ${DAILY_SUBMIT_LIMIT} requests a day. Vote on an existing one or try again tomorrow.`);
    }

    const orgId = viewer.orgId ?? "pulse-agency";
    const org = viewer.orgId
      ? await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()
      : null;
    const identity = await ctx.auth.getUserIdentity();
    const member = viewer.orgId
      ? await ctx.db
          .query("members")
          .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", viewer.clerkUserId))
          .first()
      : null;
    const requesterName = member?.name ?? identity?.name ?? undefined;
    const requesterEmail = member?.email ?? identity?.email ?? undefined;
    const orgName = org?.name ?? (viewer.orgId ? "A Pulse studio" : "Pulse");

    const id = await ctx.db.insert("featureRequests", {
      title,
      description,
      category,
      status: "pending",
      votes: 1,
      requesterOrgId: orgId,
      requesterOrgName: orgName,
      requesterClerkId: viewer.clerkUserId,
      requesterName,
      requesterEmail,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureRequestVotes", {
      requestId: id,
      voterClerkId: viewer.clerkUserId,
      voterOrgId: orgId,
      createdAt: now,
    });

    // In-app: the platform owner's bell.
    const agencyId = await platformAgencyId(ctx);
    if (agencyId) {
      await ctx.db.insert("agencyNotifications", {
        agencyId,
        kind: "feature_request.new",
        title: `New feature request: ${title}`,
        body: `${orgName}${requesterName ? `, ${requesterName}` : ""}${description ? `: ${description.slice(0, 160)}` : ""}`,
        href: "/agency/feature-requests",
        refId: id,
        createdAt: now,
      });
    }
    // Email: after commit, so a send failure never undoes the request.
    await ctx.scheduler.runAfter(0, internal.featureRequests.emailOwner, { requestId: id });
    return id;
  },
});

// ── Platform owner ──────────────────────────────────────────────────

/** Everything, including who asked. Platform owner only. */
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireAdmin(ctx);
    const rows = (await ctx.db.query("featureRequests").withIndex("by_votes").order("desc").take(BOARD_CAP))
      .sort(boardSort);
    const voted = await votedSet(ctx, viewer.clerkUserId ?? "");
    const titles = new Map(rows.map((r) => [r._id as string, r.title]));
    return rows.map((r) => ({
      ...publicRow(r, voted, false),
      requesterOrgName: r.requesterOrgName,
      requesterName: r.requesterName ?? null,
      requesterEmail: r.requesterEmail ?? null,
      mergedInto: r.mergedInto ?? null,
      mergedIntoTitle: r.mergedInto ? titles.get(r.mergedInto as string) ?? null : null,
    }));
  },
});

export const setStatus = mutation({
  args: { requestId: v.id("featureRequests"), status: statusV },
  handler: async (ctx, { requestId, status }) => {
    await requireAdmin(ctx);
    const req = await ctx.db.get(requestId);
    if (!req) fail("NOT_FOUND", "Request not found.");
    if (!(FEATURE_STATUSES as readonly string[]).includes(status)) fail("INVALID", "Unknown status.");
    await ctx.db.patch(requestId, { status, updatedAt: Date.now() });
    return { status };
  },
});

export const edit = mutation({
  args: {
    requestId: v.id("featureRequests"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const req = await ctx.db.get(args.requestId);
    if (!req) fail("NOT_FOUND", "Request not found.");
    const patch: Partial<Doc<"featureRequests">> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = cleanTitle(args.title);
    if (args.description !== undefined) patch.description = cleanDescription(args.description);
    if (args.category !== undefined) patch.category = cleanCategory(args.category || undefined);
    await ctx.db.patch(args.requestId, patch);
  },
});

/** Fold a duplicate into another request: the duplicate's votes move over
 *  (one per person), and the duplicate leaves the board. */
export const merge = mutation({
  args: { fromId: v.id("featureRequests"), intoId: v.id("featureRequests") },
  handler: async (ctx, { fromId, intoId }) => {
    await requireAdmin(ctx);
    if (fromId === intoId) fail("INVALID", "Pick a different request to merge into.");
    const from = await ctx.db.get(fromId);
    const into = await ctx.db.get(intoId);
    if (!from || !into) fail("NOT_FOUND", "Request not found.");
    if (into.mergedInto) fail("INVALID", "That request was itself merged. Pick the one it points to.");
    if (from.mergedInto) fail("INVALID", "That request is already merged.");
    const moving = await ctx.db
      .query("featureRequestVotes")
      .withIndex("by_request", (q) => q.eq("requestId", fromId))
      .collect();
    let gained = 0;
    for (const vote of moving) {
      const dup = await ctx.db
        .query("featureRequestVotes")
        .withIndex("by_request_voter", (q) => q.eq("requestId", intoId).eq("voterClerkId", vote.voterClerkId))
        .first();
      if (dup) {
        await ctx.db.delete(vote._id);
      } else {
        await ctx.db.patch(vote._id, { requestId: intoId });
        gained += 1;
      }
    }
    const now = Date.now();
    await ctx.db.patch(intoId, { votes: into.votes + gained, updatedAt: now });
    await ctx.db.patch(fromId, { mergedInto: intoId, votes: 0, updatedAt: now });
    return { votes: into.votes + gained };
  },
});

// ── Owner bell ──────────────────────────────────────────────────────

export const notifications = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireAdmin(ctx);
    } catch {
      return { unread: 0, items: [] };
    }
    const agencyId = await platformAgencyId(ctx);
    if (!agencyId) return { unread: 0, items: [] };
    const items = await ctx.db
      .query("agencyNotifications")
      .withIndex("by_agency_created", (q) => q.eq("agencyId", agencyId))
      .order("desc")
      .take(30);
    return { unread: items.filter((n) => !n.readAt).length, items };
  },
});

export const markNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const agencyId = await platformAgencyId(ctx);
    if (!agencyId) return;
    const items = await ctx.db
      .query("agencyNotifications")
      .withIndex("by_agency_created", (q) => q.eq("agencyId", agencyId))
      .order("desc")
      .take(50);
    const now = Date.now();
    for (const n of items) if (!n.readAt) await ctx.db.patch(n._id, { readAt: now });
  },
});

// ── Owner email ─────────────────────────────────────────────────────

/** Who gets the email: the Pulse agency's active owners; otherwise the first
 *  operator on AGENCY_ADMIN_EMAILS; FEATURE_REQUEST_EMAIL overrides both. */
export const _notifyContext = internalQuery({
  args: { requestId: v.id("featureRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req) return null;
    const override = (process.env.FEATURE_REQUEST_EMAIL ?? "")
      .split(",").map((e) => e.trim()).filter(Boolean);
    let to = override;
    if (to.length === 0) {
      const agencyId = await platformAgencyId(ctx);
      if (agencyId) {
        const members = await ctx.db
          .query("agencyMembers")
          .withIndex("by_agency_clerk", (q) => q.eq("agencyId", agencyId))
          .collect();
        to = members.filter((m) => m.role === "owner" && m.status === "active" && m.email).map((m) => m.email);
      }
    }
    if (to.length === 0) {
      const first = (process.env.AGENCY_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean)[0];
      if (first) to = [first];
    }
    return { req, to };
  },
});

export const emailOwner = internalAction({
  args: { requestId: v.id("featureRequests") },
  handler: async (ctx, { requestId }) => {
    const data = await ctx.runQuery(internal.featureRequests._notifyContext, { requestId });
    if (!data || data.to.length === 0) return { sent: 0 };
    const { req, to } = data;
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const link = `${appUrl}/agency/feature-requests`;
    const row = (label: string, value: string) =>
      `<p style="margin:0 0 6px"><b>${label}:</b> ${escapeHtml(value)}</p>`;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111">
      <p style="font-size:16px;margin:0 0 12px"><b>New feature request</b></p>
      ${row("Title", req.title)}
      ${row("Studio", req.requesterOrgName)}
      ${row("From", [req.requesterName, req.requesterEmail].filter(Boolean).join(", ") || "Unknown")}
      ${req.category ? row("Category", req.category) : ""}
      ${req.description ? `<p style="margin:12px 0 4px"><b>Details:</b></p><p style="white-space:pre-wrap;border-left:3px solid #b8860b;padding-left:12px;color:#333;margin:0">${escapeHtml(req.description)}</p>` : ""}
      <p style="margin:16px 0 0"><a href="${link}">Open the board to set a status or merge a duplicate</a></p>
    </div>`;
    let sent = 0;
    for (const addr of to) {
      const status = await sendEmail({
        to: addr,
        subject: `New feature request: ${req.title}`,
        html,
        audience: "internal",
      });
      if (status !== "failed") sent += 1;
    }
    return { sent };
  },
});

