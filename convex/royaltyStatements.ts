import { action, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { resolveViewer } from "./lib/access";
import { requireRoyalties } from "./lib/royaltiesGate";
import { GUEST_SCOPE_DEFAULT_TTL_MS } from "./lib/accessPolicies";
import { sameEmail, validEmail } from "./lib/emailKey";
import { sendEmail } from "./lib/email";
import { brandEmail } from "./lib/emailLayout";
import { escapeHtml } from "./lib/text";
import { appUrl } from "./lib/links";
import { sharesFor } from "./royalties";

/* ============================================================
   Contributor Statements. The studio presses Send (never automatic):
   each contributor on a statement gets an email of their shares with a
   private link to a no-login page of their whole history at that
   studio. The link is a collaboratorGrants row, scope
   "royalty_statement", entityId = the studio's orgId, keyed by the
   contributor's email, 180 days, revocable; re-sending replaces it.
   The page shows that contributor's own shares and nothing else.
   ============================================================ */

const SCOPE = "royalty_statement" as const;

async function admin(
  ctx: QueryCtx | MutationCtx,
): Promise<{ orgId: string; actor: string }> {
  const viewer = await resolveViewer(ctx);
  let out: { orgId: string; actor: string } | null = null;
  if (
    viewer.kind === "studio_member" &&
    (viewer.role === "owner" || viewer.role === "manager")
  ) {
    out = { orgId: viewer.orgId, actor: viewer.clerkUserId };
  } else if (viewer.kind === "agency_member" && viewer.orgId) {
    out = { orgId: viewer.orgId, actor: viewer.clerkUserId };
  }
  if (!out)
    throw new ConvexError({
      code: "CAPABILITY_DENIED",
      message: "Only an owner or manager can send statements.",
    });
  await requireRoyalties(ctx, out.orgId);
  return out;
}

const newToken = () =>
  crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

async function liveGrants(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  email: string,
) {
  const rows = await ctx.db
    .query("collaboratorGrants")
    .withIndex("by_entity", (q) => q.eq("entityId", orgId))
    .collect();
  return rows.filter(
    (g) =>
      g.scope === SCOPE &&
      g.orgId === orgId &&
      !g.revoked &&
      sameEmail(g.email, email),
  );
}

type Recipient = {
  email: string;
  name: string;
  token: string;
  lines: {
    songTitle: string;
    pct: number;
    currency: string;
    amountCents: number;
  }[];
};

/** Mint (or replace) one link per contributor with an email on this statement. */
export const _issueLinks = internalMutation({
  args: {
    statementId: v.id("royaltyStatements"),
    contributorKey: v.optional(v.string()),
  },
  handler: async (ctx, { statementId, contributorKey }) => {
    const { orgId, actor } = await admin(ctx);
    const st = await ctx.db.get(statementId);
    if (!st || st.orgId !== orgId)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Statement not found.",
      });
    const shares = await ctx.db
      .query("royaltyShares")
      .withIndex("by_statement", (q) => q.eq("statementId", statementId))
      .collect();
    const by = new Map<string, Doc<"royaltyShares">[]>();
    for (const s of shares) {
      if (contributorKey && s.contributorKey !== contributorKey) continue;
      by.set(s.contributorKey, [...(by.get(s.contributorKey) ?? []), s]);
    }
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const recipients: Recipient[] = [];
    const noEmail: string[] = [];
    const titles = new Map<string, string>();
    for (const [key, rows] of by) {
      if (!validEmail(key)) {
        noEmail.push(rows[0].name);
        continue;
      }
      for (const g of await liveGrants(ctx, orgId, key))
        await ctx.db.patch(g._id, { revoked: true });
      const token = newToken();
      await ctx.db.insert("collaboratorGrants", {
        orgId,
        email: key,
        name: rows[0].name,
        scope: SCOPE,
        entityId: orgId,
        capabilities: ["royalties.statement.read"],
        token,
        expiresAt: Date.now() + GUEST_SCOPE_DEFAULT_TTL_MS[SCOPE],
        invitedBy: actor,
        useCount: 0,
      });
      const lines = [];
      for (const r of rows) {
        if (!titles.has(r.songId))
          titles.set(
            r.songId,
            (await ctx.db.get(r.songId))?.title ?? "Untitled",
          );
        lines.push({
          songTitle: titles.get(r.songId)!,
          pct: r.pct,
          currency: r.currency,
          amountCents: r.amountCents,
        });
      }
      recipients.push({ email: key, name: rows[0].name, token, lines });
    }
    return {
      studioName: org?.name ?? "Your studio",
      periodStart: st.periodStart ?? null,
      periodEnd: st.periodEnd ?? null,
      recipients,
      noEmail,
    };
  },
});

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};
const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function statementEmail(a: {
  studioName: string;
  name: string;
  periodStart: number | null;
  periodEnd: number | null;
  lines: Recipient["lines"];
  link: string;
}): { subject: string; html: string } {
  const period = a.periodStart
    ? (() => {
        const s = MONTH.format(a.periodStart);
        const e = a.periodEnd ? MONTH.format(a.periodEnd) : s;
        return s === e ? s : `${s} to ${e}`;
      })()
    : "this statement";
  const totals = new Map<string, number>();
  for (const l of a.lines)
    totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amountCents);
  const total = [...totals].map(([c, cents]) => money(cents, c)).join(" + ");
  const rows = a.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #e7e7ea;">${escapeHtml(l.songTitle)}</td><td style="padding:6px 8px;border-bottom:1px solid #e7e7ea;text-align:right;color:#6e6e76;">${l.pct}%</td><td style="padding:6px 0;border-bottom:1px solid #e7e7ea;text-align:right;">${escapeHtml(money(l.amountCents, l.currency))}</td></tr>`,
    )
    .join("");
  const studio = escapeHtml(a.studioName);
  const bodyHtml = `
<p>Hi ${escapeHtml(a.name.split(" ")[0] || a.name)},</p>
<p>Here are your royalty shares from ${studio} for ${escapeHtml(period)}, divided by the split sheets you signed.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0;">
<tr><th align="left" style="padding:6px 0;border-bottom:2px solid #1a1a1f;">Song</th><th align="right" style="padding:6px 8px;border-bottom:2px solid #1a1a1f;">Share</th><th align="right" style="padding:6px 0;border-bottom:2px solid #1a1a1f;">Amount</th></tr>
${rows}
<tr><td style="padding:8px 0;font-weight:600;">Total</td><td></td><td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(total)}</td></tr>
</table>
<p><a href="${escapeHtml(a.link)}" style="display:inline-block;background:#fdb913;color:#0d0d10;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">See your full history</a></p>
<p style="color:#6e6e76;font-size:13px;">Payment comes from ${studio} directly. The link is private to you and works for 180 days.</p>`;
  const subject = `Your royalty statement from ${a.studioName}`;
  return {
    subject,
    html: brandEmail({
      title: subject,
      bodyHtml,
      preheader: `Your shares for ${period}: ${total}`,
    }),
  };
}

/** Email every contributor on a statement (or one), only when the owner presses Send. */
export const send = action({
  args: {
    statementId: v.id("royaltyStatements"),
    contributorKey: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ sent: number; failed: string[]; noEmail: string[] }> => {
    const batch = await ctx.runMutation(
      internal.royaltyStatements._issueLinks,
      args,
    );
    const base = appUrl().replace(/\/$/, "");
    let sent = 0;
    const failed: string[] = [];
    for (const r of batch.recipients) {
      const { subject, html } = statementEmail({
        studioName: batch.studioName,
        name: r.name,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        lines: r.lines,
        link: `${base}/royalty/${r.token}`,
      });
      const status = await sendEmail({ to: r.email, subject, html });
      if (status === "failed") failed.push(r.name);
      else sent++;
    }
    return { sent, failed, noEmail: batch.noEmail };
  },
});

/** Revoke a contributor's link(s) at this studio. */
export const revoke = mutation({
  args: { contributorKey: v.string() },
  handler: async (ctx, { contributorKey }) => {
    const { orgId } = await admin(ctx);
    const rows = await liveGrants(ctx, orgId, contributorKey);
    for (const g of rows) await ctx.db.patch(g._id, { revoked: true });
    return { revoked: rows.length };
  },
});

/** Public, token-authed: one contributor's own shares at one studio. */
export const view = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!/^[a-f0-9]{32,80}$/.test(token)) return null;
    const grant = await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (
      !grant ||
      grant.scope !== SCOPE ||
      grant.revoked ||
      grant.expiresAt < Date.now()
    )
      return null;
    if (grant.entityId !== grant.orgId) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", grant.orgId))
      .first();
    const shares = await sharesFor(
      ctx,
      grant.orgId,
      grant.email.trim().toLowerCase(),
    );
    return {
      studioName: org?.name ?? "Your studio",
      name: grant.name,
      expiresAt: grant.expiresAt,
      // Only this contributor's rows; never the sheet or anyone else's amounts.
      shares: shares.map((s) => ({
        songTitle: s.songTitle,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        pct: s.pct,
        currency: s.currency,
        amountCents: s.amountCents,
        paidAt: s.paidAt,
      })),
    };
  },
});
