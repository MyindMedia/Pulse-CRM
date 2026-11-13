import { internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { currentOrg, assertOrg, currentOrgWithCapability, currentActor } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { sameEmail, validEmail } from "./lib/emailKey";
import { allocateSongLines } from "./lib/royaltyAllocate";
import {
  displayStatus,
  everyoneSigned,
  isSheetExecuted,
  legacyHandTick,
  mergeContributors,
  signedByPerson,
  type SplitContributor,
} from "./lib/splitSigning";

/* What the browser may send for a contributor. `signed` is accepted so older
   clients keep working, and ignored: only the signing link sets it, and every
   signature field is carried over from the stored row (lib/splitSigning.ts). */
const contributorV = v.object({
  name: v.string(),
  role: v.string(),
  masterPct: v.number(),
  publishingPct: v.number(),
  pro: v.optional(v.string()),
  ipi: v.optional(v.string()),
  email: v.optional(v.string()),
  signed: v.optional(v.boolean()),
  fromIndex: v.optional(v.number()),
});

type Contributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
  pro?: string;
  ipi?: string;
  email?: string;
};

/** A compact, human-readable snapshot of the allocation, e.g.
    "Alice 50/50, Bob 50/50" (master/publishing). Captured into the activity
    feed so every change is an on-the-record account of who held what. */
function splitSnapshot(contributors: Contributor[]): string {
  const parts = contributors.map(
    (c) => `${c.name || "Unnamed"} ${c.masterPct}/${c.publishingPct}`,
  );
  const shown = parts.slice(0, 4).join(", ");
  return parts.length > 4 ? `${shown} +${parts.length - 4} more` : shown;
}

/** True when the recorded sheet differs (names, roles, shares, ids, emails or
    signing state) - i.e. there's an actual change worth logging. */
function contributorsChanged(a: SplitContributor[], b: SplitContributor[]): boolean {
  const key = (c: SplitContributor) =>
    [c.name, c.role, c.masterPct, c.publishingPct, c.pro ?? "", c.ipi ?? "", c.email ?? "", c.signed, c.signedAt ?? ""].join("\u0000");
  return a.length !== b.length || a.some((c, i) => key(c) !== key(b[i]));
}

/** Per-row signing state for screens: never the signature itself or emails. */
function signingState(c: SplitContributor, sheetStatus: Doc<"splitSheets">["status"]) {
  if (signedByPerson(c)) return { signedBy: "person" as const, signedAt: c.signedAt ?? null };
  if (legacyHandTick(c) || sheetStatus === "marked_by_studio") return { signedBy: "studio" as const, signedAt: null };
  return { signedBy: null, signedAt: null };
}

const MIN_NOTE = 3;
const MAX_NOTE = 1000;

/** Keep every signature that stops covering the sheet, whole, before the
 *  rows are cleared. A re-save never erases who signed, when and how. */
async function keepClearedSignatures(
  ctx: MutationCtx,
  sheet: Doc<"splitSheets">,
  cleared: SplitContributor[],
  clearedBy: string,
  reason: string,
) {
  const now = Date.now();
  for (const c of cleared) {
    await ctx.db.insert("splitSignatureHistory", {
      orgId: sheet.orgId,
      splitSheetId: sheet._id,
      songId: sheet.songId,
      name: c.name,
      role: c.role,
      masterPct: c.masterPct,
      publishingPct: c.publishingPct,
      email: c.email,
      signedByPerson: signedByPerson(c),
      signedAt: c.signedAt,
      signature: c.signature,
      signatureKind: c.signatureKind,
      signatureFont: c.signatureFont,
      signedFromUa: c.signedFromUa,
      clearedAt: now,
      clearedBy,
      reason,
    });
  }
}

/** A signing link is tied to an email. When that email is no longer on the
 *  sheet, its unused link is revoked so it cannot sign for someone else's row
 *  if the address comes back. Bounded: one sheet's links. */
async function revokeStaleSigningLinks(
  ctx: MutationCtx,
  sheetId: Doc<"splitSheets">["_id"],
  contributors: SplitContributor[],
) {
  const grants = await ctx.db
    .query("collaboratorGrants")
    .withIndex("by_entity", (q) => q.eq("entityId", sheetId))
    .take(500);
  for (const g of grants) {
    if (g.scope !== "splitsheet" || g.revoked) continue;
    if (contributors.some((c) => sameEmail(c.email, g.email))) continue;
    await ctx.db.patch(g._id, { revoked: true });
  }
}

/** Has anyone ever signed this sheet, or has the owner ever marked it signed?
 *  Historical on purpose: clearing the signatures or unmarking the sheet must
 *  not reopen it to non-owners (H209-R2-01/02). Bounded: one indexed `.first()`. */
async function everSigned(ctx: MutationCtx, sheet: Doc<"splitSheets">): Promise<boolean> {
  if (isSheetExecuted(sheet.status)) return true;
  if (sheet.markedAt !== undefined) return true;
  if (sheet.contributors.some((c) => c.signed || signedByPerson(c))) return true;
  const kept = await ctx.db
    .query("splitSignatureHistory")
    .withIndex("by_sheet", (q) => q.eq("splitSheetId", sheet._id))
    .first();
  return kept !== null;
}

/** The sheet counts as marked signed by the studio: the owner's paper mark, or
 *  a legacy executed sheet that rests on a hand tick (shown as marked). */
function isMarked(sheet: Pick<Doc<"splitSheets">, "status" | "contributors">): boolean {
  return displayStatus(sheet) === "marked_by_studio";
}

/** Throws unless the caller is the studio owner. */
async function requireOwner(ctx: MutationCtx, orgId: string, message: string) {
  const viewer = await requireCapability(ctx, "splitsheet.edit", { orgId });
  if (viewer.kind !== "studio_member" || viewer.role !== "owner") {
    throw new ConvexError({ code: "CAPABILITY_DENIED", message });
  }
}

const OWNER_ONLY_AFTER_SIGNING =
  "Someone has already signed this split sheet. Only the studio owner can change a contributor's email or share, clear the signatures or unmark the sheet now.";

function notSignedError(contributors: SplitContributor[]) {
  const waiting = contributors.filter((c) => !signedByPerson(c)).map((c) => c.name.trim() || "Unnamed contributor");
  return new ConvexError({
    code: "SPLIT_NOT_SIGNED",
    names: waiting,
    message:
      contributors.length === 0
        ? "Add contributors and collect their signatures before the sheet can be executed."
        : `A split sheet is fully executed only when everyone has signed. Still waiting on ${waiting.join(", ")}.`,
  });
}

export const forSong = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const sheet = await ctx.db
      .query("splitSheets")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .first();
    if (!sheet || sheet.orgId !== orgId) return null;
    const masterTotal = sheet.contributors.reduce((s, c) => s + c.masterPct, 0);
    const publishingTotal = sheet.contributors.reduce((s, c) => s + c.publishingPct, 0);
    return {
      _id: sheet._id,
      _creationTime: sheet._creationTime,
      orgId: sheet.orgId,
      songId: sheet.songId,
      status: sheet.status,
      displayStatus: displayStatus(sheet),
      updatedAt: sheet.updatedAt,
      // The signature image/name and browser stay on the server; screens get
      // who signed and when.
      contributors: sheet.contributors.map((c) => ({
        name: c.name,
        role: c.role,
        masterPct: c.masterPct,
        publishingPct: c.publishingPct,
        pro: c.pro,
        ipi: c.ipi,
        email: c.email,
        signed: signedByPerson(c),
        signatureKind: c.signatureKind,
        ...signingState(c, sheet.status),
      })),
      marked:
        sheet.status === "marked_by_studio"
          ? { at: sheet.markedAt ?? null, by: sheet.markedBy ?? null, note: sheet.markedNote ?? null }
          : null,
      masterTotal,
      publishingTotal,
      balanced: masterTotal === 100 && publishingTotal === 100,
      allSigned: everyoneSigned(sheet.contributors),
    };
  },
});

export const upsert = mutation({
  args: {
    songId: v.id("songs"),
    contributors: v.array(contributorV),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("sent"), v.literal("fully_executed")),
    ),
  },
  handler: async (ctx, { songId, contributors, status }) => {
    const orgId = await currentOrgWithCapability(ctx, "splitsheet.edit");
    const song = await ctx.db.get(songId);
    assertOrg(song, orgId);

    const masterTotal = contributors.reduce((s, c) => s + c.masterPct, 0);
    const publishingTotal = contributors.reduce((s, c) => s + c.publishingPct, 0);
    if (masterTotal !== 100 || publishingTotal !== 100) {
      throw new Error(
        `Splits must total 100% - master is ${masterTotal}%, publishing is ${publishingTotal}%`,
      );
    }

    const existing = await ctx.db
      .query("splitSheets")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .first();
    if (existing && existing.orgId !== orgId) throw new Error("Not found");
    if (existing) {
      const merged = mergeContributors(existing.contributors, contributors);
      // A cleared signature (a term change, or a signed person's email
      // changed) or any such change to an executed sheet means it is no
      // longer signed by everyone: it goes back out for signature.
      const reopened =
        (merged.termsChanged || merged.emailChanged) &&
        (merged.cleared.length > 0 || isSheetExecuted(existing.status));
      let nextStatus = existing.status;
      if (reopened) nextStatus = existing.status === "draft" ? "draft" : "sent";
      if (status !== undefined) nextStatus = status;
      // Once anyone has ever signed (or the owner ever marked the sheet
      // signed), only the owner may change who a share is paid to or how big
      // it is, clear signatures, or take the sheet out of "marked". The check
      // reads the sheet's history, so clearing or unmarking first does not
      // open the door to a second save (H209-R2-01, H209-R2-02).
      const unmarks = isMarked(existing) && nextStatus !== existing.status;
      const ownerOnly =
        merged.emailChanged || merged.sharesChanged || merged.cleared.length > 0 || reopened || unmarks;
      if (ownerOnly && (await everSigned(ctx, existing))) {
        await requireOwner(ctx, orgId, OWNER_ONLY_AFTER_SIGNING);
      }
      // Only an explicit request to execute is checked here. A re-save that
      // changes nothing agreed keeps the sheet's status, so a sheet executed
      // before signatures were enforced can still have an IPI or PRO fixed.
      if (status === "fully_executed" && !everyoneSigned(merged.contributors)) {
        throw notSignedError(merged.contributors);
      }

      const changed = contributorsChanged(existing.contributors, merged.contributors);
      const actor = await currentActor(ctx);
      if (merged.cleared.length > 0) {
        await keepClearedSignatures(
          ctx, existing, merged.cleared, actor, merged.termsChanged ? "terms_changed" : "email_changed",
        );
      }
      await ctx.db.patch(existing._id, {
        contributors: merged.contributors,
        status: nextStatus,
        updatedAt: Date.now(),
      });
      if (isSheetExecuted(nextStatus)) await allocateSongLines(ctx, orgId, songId);
      if (changed) {
        // Log every revision's allocation - the "for future records" trail.
        await ctx.db.insert("activity", {
          orgId,
          kind: "split.updated",
          summary: `Split sheet updated for "${song.title}" - ${splitSnapshot(merged.contributors)}`,
          entityType: "song",
          entityId: songId,
          accent: "gold",
        });
      }
      if (merged.signedEmailChanges.length > 0) {
        // Royalty shares follow the email, so a signature never carries over
        // to a new address: it was cleared (and kept in the history above).
        await ctx.db.insert("activity", {
          orgId,
          kind: "split.signer_email_changed",
          summary:
            `Email changed after signing on "${song.title}" by ${actor}, so the signature was cleared: ` +
            merged.signedEmailChanges.map((e) => `${e.name} ${e.from || "(none)"} -> ${e.to || "(none)"}`).join("; "),
          entityType: "song",
          entityId: songId,
          accent: "gold",
        });
      }
      if (merged.emailChanged || merged.termsChanged) {
        await revokeStaleSigningLinks(ctx, existing._id, merged.contributors);
      }
      if (reopened) {
        await ctx.db.insert("activity", {
          orgId,
          kind: "split.reopened",
          summary:
            `Split sheet for "${song.title}" changed after signing, so it needs signing again. ` +
            `Before: ${splitSnapshot(existing.contributors)}. After: ${splitSnapshot(merged.contributors)}. ` +
            `${merged.cleared.length} earlier signature${merged.cleared.length === 1 ? "" : "s"} kept in the sheet's history.`,
          entityType: "song",
          entityId: songId,
          accent: "gold",
        });
      }
      return existing._id;
    }

    if (status === "fully_executed") throw notSignedError([]);
    const fresh = mergeContributors([], contributors).contributors;
    const id = await ctx.db.insert("splitSheets", {
      orgId,
      songId,
      status: status ?? "draft",
      contributors: fresh,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "split.created",
      summary: `Split sheet drafted for "${song.title}" - ${splitSnapshot(fresh)}`,
      entityType: "song",
      entityId: songId,
      accent: "gold",
    });
    return id;
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("splitSheets"),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("fully_executed")),
  },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrgWithCapability(ctx, "splitsheet.edit");
    const sheet = await ctx.db.get(id);
    assertOrg(sheet, orgId);
    if (status === "fully_executed" && !everyoneSigned(sheet.contributors)) {
      throw notSignedError(sheet.contributors);
    }
    if (sheet.status === status) return; // a second click changes nothing
    // Unmarking a sheet the owner marked signed (or a legacy executed sheet
    // resting on a hand tick) is the owner's call (H209-R2-01, H209-R2-02).
    if (isMarked(sheet)) await requireOwner(ctx, orgId, OWNER_ONLY_AFTER_SIGNING);
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    const song = await ctx.db.get(sheet.songId);
    if (status === "fully_executed") {
      // Held royalty income for this song is allocated from the signed sheet.
      await allocateSongLines(ctx, orgId, sheet.songId);
      await ctx.db.insert("activity", {
        orgId,
        kind: "split.executed",
        summary: `Split sheet fully executed${song ? ` - "${song.title}"` : ""}`,
        entityType: "song",
        entityId: sheet.songId,
        accent: "positive",
      });
    } else if (isSheetExecuted(sheet.status)) {
      await ctx.db.insert("activity", {
        orgId,
        kind: "split.reopened",
        summary: `Split sheet reopened (${status})${song ? ` - "${song.title}"` : ""}. Royalties already allocated stay as they are.`,
        entityType: "song",
        entityId: sheet.songId,
        accent: "gold",
      });
    }
  },
});

/** Owner only: record that the contributors signed outside Pulse (on paper).
 *  The sheet gets its own status, `marked_by_studio`, never shown as signed by
 *  the people; royalties and the release gate treat it as executed. Needs a
 *  note saying where the signatures are, and writes an audit event. */
export const markSignedOutsidePulse = mutation({
  args: { id: v.id("splitSheets"), note: v.string() },
  handler: async (ctx, { id, note }) => {
    const viewer = await requireCapability(ctx, "splitsheet.edit");
    if (viewer.kind !== "studio_member" || viewer.role !== "owner") {
      throw new ConvexError({
        code: "CAPABILITY_DENIED",
        message: "Only the studio owner can mark a split sheet as signed outside Pulse.",
      });
    }
    const orgId = viewer.orgId;
    const sheet = await ctx.db.get(id);
    assertOrg(sheet, orgId);
    const text = note.trim();
    if (text.length < MIN_NOTE) {
      throw new Error("Say where the signed copies are (for example: paper sheet in the studio safe).");
    }
    if (text.length > MAX_NOTE) throw new Error("Keep the note under 1,000 characters.");
    if (sheet.contributors.length === 0) throw new Error("Add the contributors first.");
    const masterTotal = sheet.contributors.reduce((s, c) => s + c.masterPct, 0);
    const publishingTotal = sheet.contributors.reduce((s, c) => s + c.publishingPct, 0);
    if (masterTotal !== 100 || publishingTotal !== 100) {
      throw new Error("Splits must total 100% before the sheet can be marked signed.");
    }
    if (everyoneSigned(sheet.contributors)) {
      throw new Error("Everyone has already signed this sheet by link.");
    }
    if (sheet.status === "marked_by_studio") return { alreadyMarked: true };

    const now = Date.now();
    const by = await currentActor(ctx);
    await ctx.db.patch(id, {
      status: "marked_by_studio",
      markedAt: now,
      markedBy: by,
      markedByUserId: viewer.clerkUserId,
      markedNote: text,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      orgId,
      viewerType: "studio_member",
      viewerId: viewer.clerkUserId,
      action: "splitsheet.mark_signed_outside",
      resource: id,
      result: "allow",
      reason: text.slice(0, 500),
    });
    const song = await ctx.db.get(sheet.songId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "split.marked_by_studio",
      summary: `Split sheet marked signed outside Pulse by ${by}${song ? ` - "${song.title}"` : ""}: ${text.slice(0, 200)}`,
      entityType: "song",
      entityId: sheet.songId,
      accent: "gold",
    });
    await allocateSongLines(ctx, orgId, sheet.songId);
    return { alreadyMarked: false };
  },
});

/** Report only, changes nothing: sheets with a contributor ticked "signed"
 *  by hand (no signature record). Decision 2(a) relabels these
 *  `marked_by_studio`; the owner reviews this list first. Page through with
 *  the returned cursor. Run from the Convex dashboard:
 *  `splitSheets:reportHandTickedSheets { "numItems": 200 }`. */
export const reportHandTickedSheets = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db
      .query("splitSheets")
      .paginate({ cursor: cursor ?? null, numItems: Math.min(Math.max(numItems ?? 200, 1), 500) });
    const rows = [];
    for (const s of page.page) {
      const ticked = s.contributors.filter(legacyHandTick);
      if (ticked.length === 0) continue;
      rows.push({
        sheetId: s._id,
        orgId: s.orgId,
        songId: s.songId,
        status: s.status,
        handTicked: ticked.map((c) => c.name),
        signedByLink: s.contributors.filter(signedByPerson).length,
        total: s.contributors.length,
        // What decision 2(a) would do: an executed sheet becomes
        // marked_by_studio (royalties keep running); others keep their status
        // and already show the ticks as "marked by studio".
        wouldBecome: s.status === "fully_executed" ? "marked_by_studio" : s.status,
      });
    }
    return { rows, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** The split sheet that needs attention, for the payments page (kit
 *  "Invoices and splits"): the latest one out for signature, else the latest
 *  draft, else the latest fully signed. Names, roles, shares and who has
 *  signed; never contributor emails or signatures. */
export const spotlight = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "splitsheet.read");
    const sheets = await ctx.db
      .query("splitSheets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (sheets.length === 0) return null;
    const rank = { sent: 0, draft: 1, marked_by_studio: 2, fully_executed: 2 } as const;
    const pick = [...sheets].sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt)[0];
    const song = await ctx.db.get(pick.songId);
    const artist = song?.artistId ? await ctx.db.get(song.artistId) : null;
    return {
      sheetId: pick._id,
      songId: pick.songId,
      songTitle: song?.title ?? "Untitled",
      artistName: artist?.name ?? null,
      status: displayStatus(pick),
      signed: pick.contributors.filter(signedByPerson).length,
      total: pick.contributors.length,
      contributors: pick.contributors.map((c) => ({
        name: c.name,
        role: c.role,
        masterPct: c.masterPct,
        publishingPct: c.publishingPct,
        signed: signedByPerson(c),
        signedBy: signingState(c, pick.status).signedBy,
      })),
    };
  },
});

/** Every split sheet in the workspace, newest first, for the Split sheets
 *  page. On every plan: Core has no Songs list, so this is where its sheets
 *  live. Names, shares and signing state; never signatures. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "splitsheet.read", undefined, { entitlement: "splitSheets" });
    const sheets = await ctx.db
      .query("splitSheets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(500);
    const out = [];
    for (const s of sheets) {
      const song = await ctx.db.get(s.songId);
      const artist = song ? await ctx.db.get(song.artistId) : null;
      out.push({
        _id: s._id,
        songId: s.songId,
        songTitle: song?.title ?? "Untitled",
        artistName: artist?.name ?? null,
        isrc: song?.isrc ?? null,
        imported: Boolean(song?.importedAt),
        status: displayStatus(s),
        updatedAt: s.updatedAt,
        signed: s.contributors.filter(signedByPerson).length,
        total: s.contributors.length,
        missingEmail: s.contributors.filter((c) => !signedByPerson(c) && !validEmail(c.email)).length,
      });
    }
    return out;
  },
});

/** Start a split sheet from nothing: a basic song (title, artist, ISRC) and an
 *  empty draft sheet, in one step. This is how Core makes sheets, since the
 *  Songs list is Growth; on Growth the song also shows in Songs. */
export const createWithSong = mutation({
  args: {
    title: v.string(),
    artistId: v.id("artists"),
    isrc: v.optional(v.string()),
  },
  handler: async (ctx, { title, artistId, isrc }) => {
    const orgId = await currentOrgWithCapability(ctx, "splitsheet.edit");
    const name = title.trim().slice(0, 200);
    if (!name) throw new Error("Give the song a title.");
    const artist = await ctx.db.get(artistId);
    assertOrg(artist, orgId);
    const cleanIsrc = isrc?.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || undefined;
    const songId = await ctx.db.insert("songs", {
      orgId,
      title: name,
      artistId,
      kind: "single",
      stage: "writing",
      isrc: cleanIsrc,
      moodTags: [],
      referenceTracks: [],
      revisionsIncluded: 3,
      revisionsUsed: 0,
      splitOnly: true,
    });
    const sheetId = await ctx.db.insert("splitSheets", {
      orgId,
      songId,
      status: "draft",
      contributors: [],
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "split.created",
      summary: `Split sheet started for "${name}" by ${artist.name}`,
      entityType: "song",
      entityId: songId,
      accent: "gold",
    });
    return { songId, sheetId };
  },
});
