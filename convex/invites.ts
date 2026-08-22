import { mutation, query, action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { requireCapability, AccessError } from "./lib/access";
import { classifyClerkCreateUserError } from "./lib/clerkErrors";
import { sendEmail } from "./lib/email";
import { normalizePhone } from "./lib/phone";
import { inviteEmailHtml, inviteEmailSubject } from "./lib/emailTemplates/invite";
import { PLAN_LIMITS } from "./lib/plans";
import { periodFor, tierForPlan } from "./usage";
import { findByEmail, normalizeEmail } from "./lib/emailKey";

/* ============================================================
   Beta studio-owner invitations. A token-backed row maps to an
   org + invited email; the branded email links to /invite/<token>.
   ============================================================ */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Internal - insert an invite row. Returns the token. */
export const record = internalMutation({
  args: {
    orgId: v.string(),
    clerkOrgId: v.optional(v.string()),
    agencyId: v.optional(v.string()),
    email: v.string(),
    ownerName: v.string(),
    studioName: v.string(),
    invitedBy: v.string(),
    emailStatus: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated")),
    ttlMs: v.optional(v.number()),
    phone: v.optional(v.string()),
    role: v.optional(
      v.union(
        v.literal("owner"), v.literal("manager"), v.literal("engineer"),
        v.literal("assistant_engineer"), v.literal("artist_relations"),
        v.literal("producer"), v.literal("intern"), v.literal("accountant"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    // ── Grant-quota enforcement. Each invite issued this calendar month counts
    //    against the plan's magicLinkGrantsPerMonth cap. The "email" usage
    //    counter is the issuance ledger; block before inserting if it would
    //    exceed the cap, then meter the send on success. ──
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    let planString: string | undefined = org?.tier;
    if (org?.agencyId) {
      const agency = await ctx.db
        .query("agencies")
        .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
        .first();
      if (agency?.plan) planString = agency.plan;
    }
    const tier = tierForPlan(planString);
    const cap = PLAN_LIMITS[tier].magicLinkGrantsPerMonth;

    const period = periodFor("email");
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_org_period_metric", (q) =>
        q.eq("orgId", args.orgId).eq("period", period).eq("metric", "email"),
      )
      .first();
    const used = counter?.value ?? 0;
    if (used >= cap) {
      throw new ConvexError(
        `Magic-link grant limit reached (${used}/${cap} this month). Upgrade your plan to send more invites.`,
      );
    }

    const token = makeToken();
    await ctx.db.insert("invites", {
      orgId: args.orgId,
      clerkOrgId: args.clerkOrgId,
      agencyId: args.agencyId,
      email: normalizeEmail(args.email),
      phone: args.phone ? (normalizePhone(args.phone) ?? undefined) : undefined,
      ownerName: args.ownerName,
      studioName: args.studioName,
      role: args.role ?? "owner",
      token,
      status: "pending",
      expiresAt: Date.now() + (args.ttlMs ?? DEFAULT_TTL_MS),
      invitedBy: args.invitedBy,
      emailStatus: args.emailStatus,
    });

    // Meter the send (metric "email") on successful issuance.
    if (counter) {
      await ctx.db.patch(counter._id, { value: counter.value + 1, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("usageCounters", {
        orgId: args.orgId,
        period,
        metric: "email",
        value: 1,
        updatedAt: Date.now(),
      });
    }

    return token;
  },
});

/** Internal - full row by token (used by the accept action). */
export const _byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first(),
});

/** Public - sanitized lookup for the invite screen. No auth. */
export const lookupByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const inv = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (!inv) return { state: "invalid" as const };
    if (inv.status === "revoked") return { state: "invalid" as const };
    if (inv.status === "accepted") return { state: "accepted" as const, email: inv.email };
    if (inv.expiresAt < Date.now()) return { state: "expired" as const };
    return {
      state: "valid" as const,
      email: inv.email,
      phone: inv.phone,
      ownerName: inv.ownerName,
      studioName: inv.studioName,
      role: inv.role,
    };
  },
});

/** Internal - attach the new Clerk user to the seeded owner member + flip status. */
export const markAccepted = internalMutation({
  args: { inviteId: v.id("invites"), clerkUserId: v.string(), phone: v.optional(v.string()) },
  handler: async (ctx, { inviteId, clerkUserId, phone }) => {
    const inv = await ctx.db.get(inviteId);
    if (!inv) throw new Error("invite not found");
    if (inv.status === "accepted") throw new Error("invite already accepted");

    /* Match the member by email CASE-INSENSITIVELY.

       An exact match looked right and failed silently: invite emails are
       lowercased on the way in, but a member row seeded from a form keeps
       whatever was typed - "Info@playbackrecording.com" against
       "info@playbackrecording.com". No match meant no clerkUserId on the
       member, and since a studio owner with no Clerk organization is resolved
       BY that member row, the studio's owner signed in to "Pulse hit a snag"
       with a workspace sitting right there. */
    const roster = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", inv.orgId))
      .collect();
    const member = findByEmail(roster, inv.email);

    if (member) {
      await ctx.db.patch(member._id, {
        clerkUserId,
        ...(phone ? { phone } : {}),
      });
    } else {
      /* No seeded row to attach to. Create one rather than letting the invite
         complete into a workspace the invitee cannot resolve. */
      await ctx.db.insert("members", {
        orgId: inv.orgId,
        name: inv.ownerName,
        email: inv.email,
        role: inv.role,
        skills: [],
        clerkUserId,
        ...(phone ? { phone } : {}),
      });
    }

    await ctx.db.patch(inviteId, { status: "accepted", acceptedAt: Date.now() });
  },
});

/* Ops repair: attach a Clerk user to the seat waiting for them.

   The same thing `betaAccess.linkMe` does for a signed-in owner, for the case
   where they cannot get far enough into the app to run it. Matches on email
   within one workspace and refuses to touch a seat that is already taken, so
   it can fill an empty chair but never take someone else's. */
export const _linkMember = internalMutation({
  args: { orgId: v.string(), email: v.string(), clerkUserId: v.string() },
  handler: async (ctx, { orgId, email, clerkUserId }) => {
    const roster = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const member = findByEmail(roster, email);
    if (!member) return { linked: false as const, reason: "no_such_member" as const };
    if (member.clerkUserId && member.clerkUserId !== clerkUserId) {
      return { linked: false as const, reason: "seat_taken" as const };
    }
    if (member.clerkUserId === clerkUserId) {
      return { linked: false as const, reason: "already_linked" as const };
    }
    await ctx.db.patch(member._id, { clerkUserId });
    return { linked: true as const, name: member.name, role: member.role };
  },
});

/** Public action - create the Clerk user, add to the org, attach the member.
 *  Called by the invite screen with the password the user chose. */
type AcceptResult =
  | { ok: true; email: string; role: string }
  | {
      ok: false;
      reason:
        | "invalid"
        | "accepted"
        | "expired"
        | "not_configured"
        | "exists"
        | "phone_exists"
        | "clerk_error";
      detail?: string;
    };

export const accept = action({
  args: { token: v.string(), name: v.string(), password: v.string(), phone: v.optional(v.string()) },
  handler: async (ctx, args): Promise<AcceptResult> => {
    const inv = await ctx.runQuery(internal.invites._byToken, { token: args.token });
    if (!inv || inv.status === "revoked") return { ok: false as const, reason: "invalid" as const };
    if (inv.status === "accepted") return { ok: false as const, reason: "accepted" as const };
    if (inv.expiresAt < Date.now()) return { ok: false as const, reason: "expired" as const };

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) return { ok: false as const, reason: "not_configured" as const };

    const [firstName, ...rest] = args.name.trim().split(" ");
    const lastName = rest.join(" ");

    // Phone: prefer what the invitee typed, fall back to any pre-filled value.
    // Normalized to E.164 for Clerk + our SMS record.
    const phone = normalizePhone(args.phone || inv.phone || "");

    // 1. Create the user (backend-created emails/phones are verified - no code
    //    step). phone_number is sent when present, which also satisfies a Clerk
    //    instance that Requires a phone number.
    const createUser = (withPhone: boolean) =>
      fetch("https://api.clerk.com/v1/users", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email_address: [inv.email],
          phone_number: withPhone && phone ? [phone] : undefined,
          password: args.password,
          first_name: firstName || undefined,
          last_name: lastName || undefined,
        }),
      });

    let userRes = await createUser(Boolean(phone));
    if (!userRes.ok) {
      let err = classifyClerkCreateUserError(await userRes.text());
      if (err.kind === "phone_exists" && phone) {
        // The phone is already an identifier on ANOTHER account (e.g. the owner
        // pre-filled their own cell on a staff invite). The phone identifier is
        // optional for us - markAccepted keeps the number on the studio's member
        // record either way - so retry without it instead of dead-ending the
        // invite with a misleading "account exists".
        userRes = await createUser(false);
        if (!userRes.ok) {
          err = classifyClerkCreateUserError(await userRes.text());
          if (err.kind === "email_exists") return { ok: false as const, reason: "exists" as const };
          // Instance insists on a phone (or another failure): tell the invitee
          // the truth so they can enter a different number on the form.
          return { ok: false as const, reason: "phone_exists" as const, detail: err.message };
        }
      } else if (err.kind === "email_exists") {
        return { ok: false as const, reason: "exists" as const };
      } else {
        // Surface Clerk's structured, actionable message - never the raw body
        // (it can echo the email / internal codes to an unauthenticated caller).
        return { ok: false as const, reason: "clerk_error" as const, detail: err.message };
      }
    }
    const user = (await userRes.json()) as { id: string };

    // 2. Add to the Clerk org (non-fatal if no clerk org). Owners + managers
    //    get org:admin; other staff roles join as org:member.
    const clerkRole =
      inv.role === "owner" || inv.role === "manager" ? "org:admin" : "org:member";
    if (inv.clerkOrgId) {
      await fetch(`https://api.clerk.com/v1/organizations/${inv.clerkOrgId}/memberships`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, role: clerkRole }),
      }).catch(() => undefined);
    }

    // 3. Attach to the Convex member row + flip status (storing the phone on
    //    the member for the studio record + future SMS).
    await ctx.runMutation(internal.invites.markAccepted, {
      inviteId: inv._id,
      clerkUserId: user.id,
      phone: phone ?? undefined,
    });

    return { ok: true as const, email: inv.email, role: inv.role };
  },
});

/** Internal - update the emailStatus field after a send attempt. */
export const setEmailStatus = internalMutation({
  args: {
    token: v.string(),
    emailStatus: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated")),
  },
  handler: async (ctx, { token, emailStatus }) => {
    const inv = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (inv) await ctx.db.patch(inv._id, { emailStatus });
  },
});

/** Agency console - list invites for a sub-account.
 *  This drives a cosmetic "invite pending" badge on the sub-account detail page.
 *  A viewer who can see the sub-account but lacks invite-management capability
 *  (e.g. a demo/studio viewer, or before an orphan sub-account is adopted into
 *  the agency) should still get the page - just without the badge. So we degrade
 *  to [] on an access denial rather than throwing, which (with no error boundary)
 *  would otherwise blank the whole route. */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    try {
      await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    } catch (e) {
      if (e instanceof AccessError) return [];
      throw e;
    }
    return await ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(20);
  },
});

/** Agency console - revoke a pending invite. */
export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const inv = await ctx.db.get(inviteId);
    if (!inv) throw new Error("invite not found");
    await requireCapability(ctx, "agency.subaccount.pause", { orgId: inv.orgId });
    await ctx.db.patch(inviteId, { status: "revoked" });
  },
});

/** Agency console - re-issue + re-send the branded invite for a sub-account owner. */
export const resend = action({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<{ inviteSent: boolean }> => {
    // Authorize: in a Clerk-configured (non-demo) deployment, only a caller who
    // can manage this sub-account may trigger a resend (prevents anyone from
    // spamming an org owner via the public action). Demo mode runs open, matching
    // the rest of the app (see resolveViewer's demo synthesis + createSubaccount).
    if (process.env.CLERK_SECRET_KEY) {
      await ctx.runQuery(internal.invites._assertCanResend, { orgId });
    }
    const identity = await ctx.auth.getUserIdentity();
    const issuer = identity?.subject ?? "system";

    const org = await ctx.runQuery(internal.invites._orgForResend, { orgId });
    if (!org) throw new Error("sub-account not found");
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const token = await ctx.runMutation(internal.invites.record, {
      orgId, clerkOrgId: org.clerkOrgId, agencyId: org.agencyId,
      email: org.ownerEmail, ownerName: org.ownerName, studioName: org.name,
      invitedBy: issuer, emailStatus: "simulated",
    });
    const status = await sendEmail({
      to: org.ownerEmail,
      subject: inviteEmailSubject(org.name),
      html: inviteEmailHtml({
        ownerName: org.ownerName, studioName: org.name,
        inviterName: "your Pulse administrator", acceptUrl: `${appUrl}/invite/${token}`,
        logoUrl: `${appUrl}/pulse-logo.png`,
      }),
    });
    await ctx.runMutation(internal.invites.setEmailStatus, { token, emailStatus: status });
    return { inviteSent: status === "sent" };
  },
});

/** Internal - throws unless the caller can manage this sub-account. Gates resend. */
export const _assertCanResend = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    return null;
  },
});

/** Internal - fetch org owner details needed by the resend action. */
export const _orgForResend = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org || !org.ownerEmail || !org.ownerName) return null;
    return { name: org.name, ownerEmail: org.ownerEmail, ownerName: org.ownerName, clerkOrgId: org.clerkOrgId, agencyId: org.agencyId };
  },
});
