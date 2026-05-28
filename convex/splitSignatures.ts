import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrg, currentActor } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Split-sheet e-signature.

   Today the split sheet has a `signed: boolean` toggle - a hollow
   flag that the rest of the product (release gates, rights export)
   trusts but isn't backed by anything. This makes it real:

     1. Studio issues a per-contributor magic-link via `issue`. A
        `collaboratorGrants` row is created per contributor email
        with scope "splitsheet" and a one-use token.
     2. Contributor visits /sign/<token> (public route). The
        `lookup` query validates the token and returns the sheet +
        which contributor row they are.
     3. They type their full legal name or draw a signature; the
        `sign` mutation stamps `signed: true` + `signedAt` +
        `signature` + `signedFromUa` onto that contributor row,
        revokes the link (single-use), and writes an audit event.
     4. When every contributor has signed, the split-sheet status
        auto-flips to `fully_executed`.
   ============================================================ */

const YEAR_MS = 365 * 24 * 3600 * 1000;

function newToken(): string {
  // Convex V8 runtime exposes Web Crypto.
  return crypto.randomUUID().replace(/-/g, "");
}

/** Studio: issue a one-use signing link per still-unsigned contributor with email.
 *  Returns the recipients + tokens so the studio can email them. */
export const issue = mutation({
  args: { splitSheetId: v.id("splitSheets") },
  handler: async (ctx, { splitSheetId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.edit", { orgId });
    const sheet = await ctx.db.get(splitSheetId);
    if (!sheet || sheet.orgId !== orgId) throw new Error("Split sheet not found");
    const actor = await currentActor(ctx);

    const expiresAt = Date.now() + YEAR_MS;
    const out: { name: string; email: string; token: string; contributorIndex: number }[] = [];

    for (let i = 0; i < sheet.contributors.length; i++) {
      const c = sheet.contributors[i];
      if (c.signed) continue;
      if (!c.email || !c.email.trim()) continue;

      // Revoke any prior unused signing grants for this sheet+email so a
      // re-issue cleanly supersedes the old link.
      const stale = await ctx.db
        .query("collaboratorGrants")
        .withIndex("by_entity", (q) => q.eq("entityId", splitSheetId))
        .collect();
      for (const g of stale) {
        if (
          g.scope === "splitsheet" &&
          !g.revoked &&
          g.email.toLowerCase() === c.email.toLowerCase()
        ) {
          await ctx.db.patch(g._id, { revoked: true });
        }
      }

      const token = newToken();
      await ctx.db.insert("collaboratorGrants", {
        orgId,
        email: c.email,
        name: c.name,
        scope: "splitsheet",
        entityId: splitSheetId,
        capabilities: ["splitsheet.sign"],
        token,
        expiresAt,
        invitedBy: actor ?? "studio",
        useCount: 0,
      });
      out.push({ name: c.name, email: c.email, token, contributorIndex: i });
    }

    // Move the sheet to "sent" so the UI reflects that links are out.
    if (out.length > 0 && sheet.status === "draft") {
      await ctx.db.patch(splitSheetId, { status: "sent", updatedAt: Date.now() });
    }
    return out;
  },
});

/** Public (token-authed): what the signer needs to see on /sign/[token]. */
export const lookup = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const grant = await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!grant || grant.revoked || grant.expiresAt < Date.now() || grant.scope !== "splitsheet") return null;

    const sheet = await ctx.db.get(grant.entityId as Id<"splitSheets">);
    if (!sheet) return null;
    const idx = sheet.contributors.findIndex(
      (c) => c.email && c.email.toLowerCase() === grant.email.toLowerCase(),
    );
    if (idx < 0) return null;
    const song = await ctx.db.get(sheet.songId);
    const artist = song ? await ctx.db.get(song.artistId) : null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", sheet.orgId)).first();
    return {
      studioName: org?.name ?? "the studio",
      song: song ? { title: song.title, artist: artist?.name ?? "Unknown" } : null,
      sheet: { _id: sheet._id, status: sheet.status, contributors: sheet.contributors },
      signer: { name: grant.name, email: grant.email, contributorIndex: idx },
      alreadySigned: sheet.contributors[idx].signed,
      expiresAt: grant.expiresAt,
    };
  },
});

/** Public (token-authed): stamp the signature onto the contributor row. */
export const sign = mutation({
  args: { token: v.string(), signature: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, { token, signature, userAgent }) => {
    const trimmed = signature.trim();
    if (trimmed.length === 0) throw new Error("Signature cannot be empty.");
    if (trimmed.length > 4096) throw new Error("Signature is too long.");

    const grant = await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!grant || grant.revoked || grant.expiresAt < Date.now() || grant.scope !== "splitsheet") {
      throw new Error("This signing link is no longer valid.");
    }
    const sheet = await ctx.db.get(grant.entityId as Id<"splitSheets">);
    if (!sheet) throw new Error("Split sheet not found.");

    const idx = sheet.contributors.findIndex(
      (c) => c.email && c.email.toLowerCase() === grant.email.toLowerCase(),
    );
    if (idx < 0) throw new Error("Signer not found on this split sheet.");

    const now = Date.now();
    const next: Doc<"splitSheets">["contributors"] = sheet.contributors.map((c, i) =>
      i === idx
        ? { ...c, signed: true, signedAt: now, signature: trimmed, signedFromUa: userAgent }
        : c,
    );
    await ctx.db.patch(sheet._id, { contributors: next, updatedAt: now });

    // Single-use: revoke the link after a successful sign.
    await ctx.db.patch(grant._id, {
      revoked: true,
      firstUsedAt: grant.firstUsedAt ?? now,
      lastUsedAt: now,
      useCount: grant.useCount + 1,
    });

    // If everyone has signed, flip the sheet to fully executed.
    const allSigned = next.every((c) => c.signed);
    if (allSigned && sheet.status !== "fully_executed") {
      await ctx.db.patch(sheet._id, { status: "fully_executed", updatedAt: now });
    }

    await ctx.db.insert("auditEvents", {
      orgId: sheet.orgId,
      viewerType: "guest",
      viewerId: grant.email,
      action: "splitsheet.sign",
      resource: sheet._id,
      result: "allow",
      reason: "magic_link",
    });

    return { ok: true, allSigned };
  },
});
