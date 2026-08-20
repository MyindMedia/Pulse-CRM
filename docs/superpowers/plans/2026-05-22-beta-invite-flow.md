# Beta Invite Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agency adds a studio sub-account, the owner receives a custom branded HTML email (via Resend) with a unique link to a Pulse-native account-creation screen that creates their login and drops them into their dashboard.

**Architecture:** A new Convex `invites` table holds a URL-safe token mapping to the org + invited email. `createSubaccount` provisions the org (and a Clerk organization), records an invite, and sends a branded Resend email linking to `/invite/<token>`. The custom screen looks the token up (public query), collects name + password, and an `invites.accept` action creates the Clerk user via the **Backend REST API** (email auto-verified), adds them to the Clerk org, and attaches them to the seeded Convex `members` row. The client then password-signs-in and redirects to `/dashboard`.

**Tech Stack:** Convex 1.39, Next.js 16.2.6 (App Router), Clerk (`@clerk/nextjs` 7.x, headless `useSignIn`), Resend REST API, vitest + convex-test, Playwright.

**Scope note (refinement from spec):** Google SSO is **deferred post-beta**. Clerk's invitation "ticket" (the only way to OAuth-sign-up with a pre-verified email) is delivered only inside Clerk's own email, which conflicts with sending a custom Resend email. Beta is password-based; the Google button is not rendered. Everything else matches `docs/superpowers/specs/2026-05-22-beta-invite-flow-design.md`.

**Pre-req reading (Next 16):** Per `AGENTS.md`, before writing route/page code read the relevant guide under `node_modules/next/dist/docs/`. In particular, dynamic route `params` and `useParams()` behavior in App Router 16.

---

## File Structure

- **Create** `convex/invites.ts` — invite lifecycle: `record` (internal), `_byToken` (internal), `lookupByToken` (public query), `accept` (action), `markAccepted` (internal), `revoke` (mutation), `list` (query).
- **Create** `convex/lib/email.ts` — `sendEmail()` Resend REST wrapper.
- **Create** `convex/lib/emailTemplates/invite.ts` — `inviteEmailHtml()` branded HTML string.
- **Create** `convex/invites.test.ts` — unit tests (convex-test).
- **Create** `convex/lib/email.test.ts` — Resend payload test (mock fetch).
- **Modify** `convex/schema.ts` — add `invites` table.
- **Modify** `convex/agency.ts` — `createSubaccount` records invite + sends branded email; export the orgName + clerkOrgId needed by accept.
- **Create** `src/app/invite/[token]/page.tsx` — the Pulse-native account screen + invalid/expired/accepted states.
- **Modify** `src/app/sign-up/[[...sign-up]]/page.tsx` — beta is invite-only: replace open registration with an "invitation required" message.
- **Modify** `src/components/agency/create-subaccount-dialog.tsx` — success toast copy reflects the branded email send.
- **Create** `src/components/agency/resend-invite-button.tsx` + **Modify** the sub-account detail page (`src/app/agency/[orgId]/...`) — "Resend invite" action for a `pending` invite.
- **Create** `tests/e2e/invite-flow.spec.ts` — Playwright e2e (valid render + invalid token).

**New env vars:** `RESEND_API_KEY` (from `op://Security/Resend Pulse/Api`), `APP_URL` (absolute base for links + logo, e.g. `https://app.pulse.studio` or `http://localhost:3000` in dev), `RESEND_FROM` (default `Pulse <hello@pulse.studio>`).

---

## Task 1: `invites` table in schema

**Files:**
- Modify: `convex/schema.ts` (add table next to `collaboratorGrants`, ~line 235)

- [ ] **Step 1: Add the table definition**

In `convex/schema.ts`, inside `defineSchema({ ... })`, add:

```ts
  invites: defineTable({
    orgId: v.string(),                       // Convex org being joined
    clerkOrgId: v.optional(v.string()),      // Clerk org id (for membership)
    agencyId: v.optional(v.string()),        // denormalized for console/audit
    email: v.string(),                       // invited owner email (lowercased)
    ownerName: v.string(),
    studioName: v.string(),                  // shown on the screen + email
    role: v.literal("owner"),                // beta: studio owners only
    token: v.string(),                       // URL-safe random
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    expiresAt: v.number(),
    invitedBy: v.string(),                    // clerkUserId of issuer, or "system"
    emailStatus: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("simulated"),
    ),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_org", ["orgId"])
    .index("by_email", ["email"]),
```

- [ ] **Step 2: Regenerate Convex types**

Run: `npx convex codegen --typecheck=disable`
Expected: completes with no error; `convex/_generated/dataModel.d.ts` now includes `invites`.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(invites): add invites table to schema"
```

---

## Task 2: invite token helpers + record/lookup (TDD)

**Files:**
- Create: `convex/invites.ts`
- Test: `convex/invites.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/invites.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

describe("invites - record + lookup", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedOrg(orgId = "studio_skyline") {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId, name: "Skyline", slug: "skyline", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId, name: "Jordan", email: "owner@skyline.com", role: "owner", skills: [] });
    });
    return orgId;
  }

  it("record → lookupByToken returns sanitized invite while pending", async () => {
    const orgId = await seedOrg();
    const token = await t.mutation(internal.invites.record, {
      orgId, clerkOrgId: "org_clerk1", email: "owner@skyline.com",
      ownerName: "Jordan", studioName: "Skyline", invitedBy: "system",
      emailStatus: "sent", ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(typeof token).toBe("string");
    const got = await t.query(api.invites.lookupByToken, { token });
    expect(got).toMatchObject({ state: "valid", email: "owner@skyline.com", studioName: "Skyline", ownerName: "Jordan" });
  });

  it("lookupByToken returns {state:'invalid'} for unknown token", async () => {
    const got = await t.query(api.invites.lookupByToken, { token: "nope" });
    expect(got).toEqual({ state: "invalid" });
  });

  it("lookupByToken returns {state:'expired'} after expiry", async () => {
    const orgId = await seedOrg();
    const token = await t.mutation(internal.invites.record, {
      orgId, email: "owner@skyline.com", ownerName: "Jordan",
      studioName: "Skyline", invitedBy: "system", emailStatus: "sent", ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const got = await t.query(api.invites.lookupByToken, { token });
    expect(got).toEqual({ state: "expired" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/invites.test.ts`
Expected: FAIL — `internal.invites.record` / `api.invites.lookupByToken` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `convex/invites.ts`:

```ts
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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

/** Internal — insert an invite row. Returns the token. */
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
  },
  handler: async (ctx, args) => {
    const token = makeToken();
    await ctx.db.insert("invites", {
      orgId: args.orgId,
      clerkOrgId: args.clerkOrgId,
      agencyId: args.agencyId,
      email: args.email.toLowerCase(),
      ownerName: args.ownerName,
      studioName: args.studioName,
      role: "owner",
      token,
      status: "pending",
      expiresAt: Date.now() + (args.ttlMs ?? DEFAULT_TTL_MS),
      invitedBy: args.invitedBy,
      emailStatus: args.emailStatus,
    });
    return token;
  },
});

/** Internal — full row by token (used by the accept action). */
export const _byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first(),
});

/** Public — sanitized lookup for the invite screen. No auth. */
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
      ownerName: inv.ownerName,
      studioName: inv.studioName,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/invites.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/invites.ts convex/invites.test.ts
git commit -m "feat(invites): token record + sanitized lookup"
```

---

## Task 3: accept action + markAccepted + revoke/list (TDD)

The `accept` action calls the Clerk Backend REST API. In tests we inject a fake fetch via a module-level seam so no network call is made.

**Files:**
- Modify: `convex/invites.ts`
- Test: `convex/invites.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to `convex/invites.test.ts`)**

```ts
import { vi } from "vitest";

describe("invites - accept + revoke", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); vi.restoreAllMocks(); });

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "studio_x", name: "X", slug: "x", plan: "studio", status: "active", clerkOrgId: "org_c" });
      await ctx.db.insert("members", { orgId: "studio_x", name: "Jordan", email: "o@x.com", role: "owner", skills: [] });
    });
    return await t.mutation(internal.invites.record, {
      orgId: "studio_x", clerkOrgId: "org_c", email: "o@x.com",
      ownerName: "Jordan", studioName: "X", invitedBy: "system", emailStatus: "sent",
    });
  }

  it("markAccepted attaches clerkUserId to owner member + flips status", async () => {
    const token = await seed();
    const inv = await t.query(api.invites.lookupByToken, { token });
    expect(inv.state).toBe("valid");
    await t.run(async (ctx) => {
      const row = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
      await ctx.runMutation(internal.invites.markAccepted, { inviteId: row!._id, clerkUserId: "user_new" });
    });
    const after = await t.query(api.invites.lookupByToken, { token });
    expect(after.state).toBe("accepted");
    const member = await t.run(async (ctx) =>
      await ctx.db.query("members").withIndex("by_org_clerk", (q) => q.eq("orgId", "studio_x").eq("clerkUserId", "user_new")).first());
    expect(member).not.toBeNull();
  });

  it("markAccepted twice is a no-op the second time (guard)", async () => {
    const token = await seed();
    const row = await t.run(async (ctx) =>
      await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first());
    await t.run(async (ctx) => ctx.runMutation(internal.invites.markAccepted, { inviteId: row!._id, clerkUserId: "u1" }));
    await expect(
      t.run(async (ctx) => ctx.runMutation(internal.invites.markAccepted, { inviteId: row!._id, clerkUserId: "u2" })),
    ).rejects.toThrow(/already accepted/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/invites.test.ts`
Expected: FAIL — `internal.invites.markAccepted` does not exist.

- [ ] **Step 3: Write minimal implementation (append to `convex/invites.ts`)**

```ts
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireCapability } from "./lib/access";

/** Internal — attach the new Clerk user to the seeded owner member + flip status. */
export const markAccepted = internalMutation({
  args: { inviteId: v.id("invites"), clerkUserId: v.string() },
  handler: async (ctx, { inviteId, clerkUserId }) => {
    const inv = await ctx.db.get(inviteId);
    if (!inv) throw new Error("invite not found");
    if (inv.status === "accepted") throw new Error("invite already accepted");

    const member = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", inv.orgId))
      .filter((q) => q.eq(q.field("email"), inv.email))
      .first();
    if (member) await ctx.db.patch(member._id, { clerkUserId });

    await ctx.db.patch(inviteId, { status: "accepted", acceptedAt: Date.now() });
  },
});

/** Public action — create the Clerk user, add to the org, attach the member.
 *  Called by the invite screen with the password the user chose. */
export const accept = action({
  args: { token: v.string(), name: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const inv = await ctx.runQuery(internal.invites._byToken, { token: args.token });
    if (!inv || inv.status === "revoked") return { ok: false as const, reason: "invalid" as const };
    if (inv.status === "accepted") return { ok: false as const, reason: "accepted" as const };
    if (inv.expiresAt < Date.now()) return { ok: false as const, reason: "expired" as const };

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) return { ok: false as const, reason: "not_configured" as const };

    const [firstName, ...rest] = args.name.trim().split(" ");
    const lastName = rest.join(" ");

    // 1. Create the user (backend-created emails are verified → no code step).
    const userRes = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: [inv.email],
        password: args.password,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
      }),
    });
    if (!userRes.ok) {
      const body = await userRes.text();
      if (/already exists|taken|duplicate/i.test(body)) return { ok: false as const, reason: "exists" as const };
      return { ok: false as const, reason: "clerk_error" as const, detail: body };
    }
    const user = (await userRes.json()) as { id: string };

    // 2. Add to the Clerk org as admin (non-fatal if no clerk org).
    if (inv.clerkOrgId) {
      await fetch(`https://api.clerk.com/v1/organizations/${inv.clerkOrgId}/memberships`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, role: "org:admin" }),
      }).catch(() => undefined);
    }

    // 3. Attach to the Convex member row + flip status.
    await ctx.runMutation(internal.invites.markAccepted, { inviteId: inv._id, clerkUserId: user.id });

    return { ok: true as const, email: inv.email };
  },
});

/** Agency console — list invites for a sub-account. */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    return await ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(20);
  },
});

/** Agency console — revoke a pending invite. */
export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const inv = await ctx.db.get(inviteId);
    if (!inv) throw new Error("invite not found");
    await requireCapability(ctx, "agency.subaccount.pause", { orgId: inv.orgId });
    await ctx.db.patch(inviteId, { status: "revoked" });
  },
});
```

> **Verify-during-build:** `agency.subaccount.pause` is the capability used by `agency.setStatus` for sub-account control; confirm it exists in `convex/lib/capabilities` (it does, per `convex/agency.ts:setStatus`). If the project later adds a dedicated `invites.*` capability, swap it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/invites.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add convex/invites.ts convex/invites.test.ts
git commit -m "feat(invites): accept action, markAccepted guard, list/revoke"
```

---

## Task 4: Resend email sender (TDD)

**Files:**
- Create: `convex/lib/email.ts`
- Test: `convex/lib/email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/lib/email.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail } from "./email";

afterEach(() => { vi.restoreAllMocks(); delete process.env.RESEND_API_KEY; });

describe("sendEmail", () => {
  it("returns 'simulated' when RESEND_API_KEY is unset", async () => {
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("simulated");
  });

  it("POSTs to Resend and returns 'sent' on ok", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "e1" }), { status: 200 }),
    );
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ to: ["a@b.com"], subject: "Hi" });
  });

  it("returns 'failed' on non-ok response", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/lib/email.test.ts`
Expected: FAIL — cannot find module `./email`.

- [ ] **Step 3: Write minimal implementation**

Create `convex/lib/email.ts`:

```ts
/* Resend transactional email. Returns a status string so callers can
   record it on the invite row. No-ops to "simulated" when unconfigured. */
export type EmailStatus = "sent" | "failed" | "simulated";

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<EmailStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "simulated";
  const from = args.from ?? process.env.RESEND_FROM ?? "Pulse <hello@pulse.studio>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [args.to], subject: args.subject, html: args.html }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/lib/email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/email.ts convex/lib/email.test.ts
git commit -m "feat(email): Resend sender with simulated fallback"
```

---

## Task 5: branded invitation email template

**Files:**
- Create: `convex/lib/emailTemplates/invite.ts`
- Test: `convex/lib/emailTemplates/invite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/lib/emailTemplates/invite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inviteEmailHtml, inviteEmailSubject } from "./invite";

describe("invite email template", () => {
  it("embeds studio name, inviter, accept url, and a paste-fallback link", () => {
    const html = inviteEmailHtml({
      ownerName: "Jordan", studioName: "Skyline Records",
      inviterName: "Lawrence at Myind Sound",
      acceptUrl: "https://app.pulse.studio/invite/abc123",
      logoUrl: "https://app.pulse.studio/pulse-logo.png",
    });
    expect(html).toContain("Skyline Records");
    expect(html).toContain("Lawrence at Myind Sound");
    expect(html).toContain("https://app.pulse.studio/invite/abc123");
    expect(html).toContain("https://app.pulse.studio/pulse-logo.png");
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("subject names the studio", () => {
    expect(inviteEmailSubject("Skyline Records")).toMatch(/Skyline Records/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/lib/emailTemplates/invite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `convex/lib/emailTemplates/invite.ts`. Use **table-based, inline-styled** HTML (email clients ignore `<style>` and flexbox). Mirror the approved mockup: dark gold-accented header with the PULSE logo (absolute https URL — base64 is unreliable in email), a workspace card, one gold CTA, paste-fallback, deliverability footer.

```ts
export function inviteEmailSubject(studioName: string): string {
  return `You're invited to ${studioName} on Pulse`;
}

export function inviteEmailHtml(args: {
  ownerName: string;
  studioName: string;
  inviterName: string;
  acceptUrl: string;
  logoUrl: string;
}): string {
  const { ownerName, studioName, inviterName, acceptUrl, logoUrl } = args;
  const initials = studioName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f1f3;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1a1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1f3;padding:28px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e7ea">
        <tr><td align="center" style="background:#0d0d10;border-bottom:3px solid #fdb913;padding:32px 40px">
          <img src="${logoUrl}" alt="Pulse" height="34" style="display:block;height:34px">
          <div style="margin-top:14px;display:inline-block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#fdb913;border:1px solid rgba(253,185,19,.4);border-radius:999px;padding:5px 13px;font-weight:700">Private Beta · Invitation</div>
        </td></tr>
        <tr><td style="padding:34px 40px 8px">
          <h1 style="margin:0 0 14px;font-size:22px;color:#101015">You're in. Welcome to Pulse.</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3a3a42">Hi ${ownerName}, <b>${inviterName}</b> set up a workspace for you on Pulse — the studio operating system.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ea;border-radius:12px;margin:0 0 24px">
            <tr>
              <td width="56" style="padding:16px 0 16px 18px"><div style="width:42px;height:42px;border-radius:10px;background:#101015;color:#fdb913;font-weight:800;font-size:16px;text-align:center;line-height:42px">${initials}</div></td>
              <td style="padding:16px 18px"><b style="font-size:15px;color:#101015">${studioName}</b><br><span style="font-size:13px;color:#8a8a92">Studio workspace · invited as Owner</span></td>
            </tr>
          </table>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3a3a42">Click below to claim your account and set a password. This link is unique to you and expires in 7 days.</p>
        </td></tr>
        <tr><td align="center" style="padding:0 40px 8px">
          <a href="${acceptUrl}" style="display:inline-block;background:#fdb913;color:#1a1405;font-weight:800;font-size:15px;text-decoration:none;padding:15px 28px;border-radius:11px">Accept invitation &amp; create account →</a>
        </td></tr>
        <tr><td align="center" style="padding:18px 40px 30px">
          <p style="margin:0;font-size:12px;color:#9a9aa2;line-height:1.6">Button not working? Paste this link:<br><a href="${acceptUrl}" style="color:#6a6a72">${acceptUrl}</a></p>
        </td></tr>
        <tr><td align="center" style="background:#f1f1f3;border-top:1px solid #e7e7ea;padding:20px 40px">
          <p style="margin:0;font-size:11.5px;color:#9a9aa2;line-height:1.6">You received this because ${studioName} was added to Pulse.<br>Pulse · Myind Media</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/lib/emailTemplates/invite.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/emailTemplates/invite.ts convex/lib/emailTemplates/invite.test.ts
git commit -m "feat(email): branded studio-owner invitation template"
```

---

## Task 6: wire `createSubaccount` to record + send the invite

**Files:**
- Modify: `convex/agency.ts` (`createSubaccount` handler, ~lines 295-360)
- Test: `convex/invites.test.ts` (append integration-style assertion)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("createSubaccount records an invite", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("records a pending invite row for the owner email", async () => {
    // Demo path: no CLERK_SECRET_KEY, single-tenant (no agency).
    await t.action(api.agency.createSubaccount, {
      name: "Skyline", slug: "skyline", plan: "studio",
      ownerName: "Jordan", ownerEmail: "Owner@Skyline.com",
    });
    const invites = await t.run(async (ctx) =>
      await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", "owner@skyline.com")).collect());
    expect(invites.length).toBe(1);
    expect(invites[0].status).toBe("pending");
    expect(invites[0].studioName).toBe("Skyline");
    // No RESEND_API_KEY in test → simulated.
    expect(invites[0].emailStatus).toBe("simulated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/invites.test.ts -t "records a pending invite"`
Expected: FAIL — no invite row recorded (createSubaccount doesn't touch invites yet).

- [ ] **Step 3: Implement — extend `createSubaccount`**

In `convex/agency.ts`:

(a) Add imports at top if missing:
```ts
import { sendEmail } from "./lib/email";
import { inviteEmailHtml, inviteEmailSubject } from "./lib/emailTemplates/invite";
```

(b) Replace the existing Clerk org-invitation `fetch` block (the `await fetch(.../invitations ...)` call that invites the owner) — we now send our own email instead of Clerk's. Delete that `fetch` to `/organizations/${clerkOrgId}/invitations`.

(c) After the `await ctx.runMutation(internal.agency.provision, {...})` call and before `return`, add:

```ts
    // Branded beta invite: record token + send our own Resend email.
    const issuer = self?.kind === "agency_member" && "clerkUserId" in (self as object)
      ? (self as { clerkUserId?: string }).clerkUserId ?? "system"
      : "system";
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const token = await ctx.runMutation(internal.invites.record, {
      orgId, clerkOrgId, agencyId, email: args.ownerEmail,
      ownerName: args.ownerName, studioName: args.name,
      invitedBy: issuer, emailStatus: "simulated", // updated below after send
    });
    const acceptUrl = `${appUrl}/invite/${token}`;
    const status = await sendEmail({
      to: args.ownerEmail,
      subject: inviteEmailSubject(args.name),
      html: inviteEmailHtml({
        ownerName: args.ownerName,
        studioName: args.name,
        inviterName: "your Pulse administrator",
        acceptUrl,
        logoUrl: `${appUrl}/pulse-logo.png`,
      }),
    });
    await ctx.runMutation(internal.invites.setEmailStatus, { token, emailStatus: status });

    return { orgId, slug, clerkProvisioned: Boolean(clerkOrgId), inviteSent: status === "sent" };
```

(d) Add the tiny internal mutation to `convex/invites.ts`:
```ts
export const setEmailStatus = internalMutation({
  args: { token: v.string(), emailStatus: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated")) },
  handler: async (ctx, { token, emailStatus }) => {
    const inv = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (inv) await ctx.db.patch(inv._id, { emailStatus });
  },
});
```

> Note: the existing `createSubaccount` already returns `{ orgId, slug, clerkProvisioned }`; we add `inviteSent`. Keep `import { internal }` (already present in `agency.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/invites.test.ts`
Expected: PASS (all invite tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add convex/agency.ts convex/invites.ts convex/invites.test.ts
git commit -m "feat(invites): createSubaccount records + sends branded invite email"
```

---

## Task 7: the `/invite/[token]` account-creation screen

Build the Pulse-native screen matching the approved mockup. Client component (Convex query + Clerk `useSignIn`).

**Files:**
- Create: `src/app/invite/[token]/page.tsx`
- Reference: `src/lib/clerk-appearance.ts`, `src/components/brand/pulse-logo.tsx`, `src/app/sign-in/[[...sign-in]]/page.tsx` (background/layout pattern)

- [ ] **Step 1: Read Next 16 dynamic-route docs**

Read: `node_modules/next/dist/docs/` for App Router dynamic params / `useParams`. Confirm `useParams()` from `next/navigation` is the supported client-side accessor in 16.2.6.

- [ ] **Step 2: Create the screen**

Create `src/app/invite/[token]/page.tsx`:

```tsx
"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { useSignIn } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { PulseLogo } from "@/components/brand/pulse-logo";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const invite = useQuery(api.invites.lookupByToken, { token });
  const accept = useAction(api.invites.accept);
  const { signIn, setActive, isLoaded } = useSignIn();

  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (invite?.state === "valid") setName(invite.ownerName ?? "");
  }, [invite]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !isLoaded || invite?.state !== "valid") return;
    setErr(""); setBusy(true);
    try {
      const res = await accept({ token, name: name.trim(), password });
      if (!res.ok) {
        if (res.reason === "exists") { setErr("You already have a Pulse account. Please sign in."); return; }
        setErr("This invitation could not be completed. Ask your admin to resend it."); return;
      }
      // Establish a browser session with the password they just set.
      const attempt = await signIn!.create({ identifier: res.email, password });
      if (attempt.status === "complete") {
        await setActive!({ session: attempt.createdSessionId });
        router.push("/dashboard");
      } else {
        router.push("/sign-in");
      }
    } catch {
      setErr("Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-ink p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: "radial-gradient(60% 40% at 50% 28%, rgba(253,185,19,0.10), transparent 70%)" }} />
      <div className="relative w-full max-w-sm text-center">
        <PulseLogo size="md" asLink={false} />

        {invite === undefined && <p className="mt-8 text-sm text-ash">Loading your invitation…</p>}

        {invite && invite.state !== "valid" && (
          <div className="mt-8 space-y-3">
            <h1 className="font-display text-2xl font-bold text-bone">
              {invite.state === "accepted" ? "Already claimed" : invite.state === "expired" ? "Invitation expired" : "Invalid invitation"}
            </h1>
            <p className="text-sm text-ash">
              {invite.state === "accepted"
                ? "This invitation has already been used. Sign in to continue."
                : "This link is no longer valid. Ask your administrator to resend your invite."}
            </p>
            <a href="/sign-in" className="inline-block text-sm font-medium text-gold hover:underline">Go to sign in</a>
          </div>
        )}

        {invite?.state === "valid" && (
          <form onSubmit={submit} className="mt-6 text-left">
            <p className="mb-1 text-center text-sm text-ash">Joining <b className="text-bone">{invite.studioName}</b> as Owner</p>
            <h1 className="mb-1 text-center font-display text-2xl font-bold text-bone">Create your account</h1>
            <p className="mb-6 text-center text-sm text-ash">You&apos;ve been invited to the Pulse beta. Set a password to finish.</p>

            <label className="mb-1.5 block text-xs font-semibold text-ash">Email</label>
            <div className="mb-3.5 flex items-center justify-between rounded-[10px] border border-hairline-2 bg-[#0e0e12] px-3 py-3 text-sm text-ash-2">
              <span>{invite.email}</span><span className="text-xs text-gold">🔒 invited</span>
            </div>

            <label className="mb-1.5 block text-xs font-semibold text-ash">Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Rivera"
              className="mb-3.5 w-full rounded-[10px] border border-hairline-2 bg-[#0a0a0d] px-3 py-3 text-sm text-bone outline-none focus:border-gold" />

            <label className="mb-1.5 block text-xs font-semibold text-ash">Password</label>
            <div className="mb-1 flex items-center rounded-[10px] border border-hairline-2 bg-[#0a0a0d] focus-within:border-gold">
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full bg-transparent px-3 py-3 text-sm text-bone outline-none" />
              <button type="button" onClick={() => setShow((s) => !s)} className="px-3 text-ash-2">{show ? "🙈" : "👁"}</button>
            </div>

            {err && <p className="mt-3 text-sm text-[#ff5d5d]">{err}</p>}

            <button type="submit" disabled={busy || password.length < 8 || name.trim().length < 2}
              className="mt-4 w-full rounded-[11px] bg-gold py-3.5 text-sm font-extrabold text-gold-ink disabled:opacity-50">
              {busy ? "Creating account…" : "Create account & enter Pulse"}
            </button>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-ash-2">
              By continuing you agree to the <a href="/legal" className="text-ash">Terms</a> &amp; <a href="/legal" className="text-ash">Privacy Policy</a>.
            </p>
            <p className="mt-4 text-center text-[10.5px] tracking-wide text-ash-2">⚡ Secured by Pulse · powered by Clerk</p>
            <div id="clerk-captcha" />
          </form>
        )}
      </div>
    </div>
  );
}
```

> **Tailwind tokens:** `bg-ink`, `text-bone`, `text-ash`, `text-ash-2`, `bg-gold`, `text-gold`, `text-gold-ink`, `border-hairline-2`, `font-display` are all defined in `globals.css`/theme (used across sign-in + the mockup). Confirm class names against `src/app/globals.css` and adjust if a token differs.

- [ ] **Step 3: Add `/invite` to the public-route matcher**

In `src/middleware.ts`, add `"/invite(.*)"` to the `isPublicRoute` matcher array (so an unauthenticated invitee can reach it).

- [ ] **Step 4: Manual smoke (dev)**

Run (two terminals):
```bash
npx convex dev --once    # push new functions
npm run dev
```
With no `CLERK_SECRET_KEY`/`RESEND_API_KEY`, create a sub-account from the agency console, copy the printed `acceptUrl` token from the Convex dashboard `invites` row, visit `/invite/<token>`.
Expected: screen renders with the studio name + locked email; an unknown token shows the invalid state.

- [ ] **Step 5: Commit**

```bash
git add src/app/invite/ src/middleware.ts
git commit -m "feat(invite): Pulse-native account-creation screen"
```

---

## Task 8: gate `/sign-up` to invite-only + agency "Resend invite"

**Files:**
- Modify: `src/app/sign-up/[[...sign-up]]/page.tsx`
- Create: `src/components/agency/resend-invite-button.tsx`
- Modify: the sub-account detail page (find with `grep -rn "api.agency" src/app/agency/\[orgId\]` or the page rendering a single sub-account)

- [ ] **Step 1: Make `/sign-up` invite-only**

Replace the `<SignUp>` branch in `src/app/sign-up/[[...sign-up]]/page.tsx` with an "invitation required" message (keep the demo-mode branch and the surrounding layout/`PulseLogo`):

```tsx
<div className="space-y-3 text-center">
  <p className="overline">Pulse · private beta</p>
  <h1 className="font-display text-2xl font-bold text-bone">Invitation required</h1>
  <p className="text-sm text-ash">Pulse is in private beta. New studios join from an emailed invitation. If you have one, open the link in that email.</p>
  <Link href="/sign-in" className="inline-block text-sm font-medium text-gold hover:underline">Already have an account? Sign in</Link>
</div>
```
Remove the now-unused `SignUp` import + `clerkAppearance` if no longer referenced.

- [ ] **Step 2: Build the Resend-invite button**

Create `src/components/agency/resend-invite-button.tsx`:

```tsx
"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Re-issues + re-sends the branded invite for a sub-account whose owner
 *  hasn't accepted yet. Re-uses createSubaccount's send path via a thin
 *  resend action. */
export function ResendInviteButton({ orgId }: { orgId: string }) {
  const resend = useAction(api.invites.resend);
  const [busy, setBusy] = React.useState(false);
  return (
    <Button variant="ghost" size="sm" disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { const r = await resend({ orgId }); toast.success(r.inviteSent ? "Invite re-sent." : "Invite re-issued (email simulated)."); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Could not resend."); }
        finally { setBusy(false); }
      }}>
      {busy ? "Sending…" : "Resend invite"}
    </Button>
  );
}
```

- [ ] **Step 3: Add the `resend` action (TDD)**

Append to `convex/invites.test.ts`:

```ts
it("resend re-issues a fresh pending invite for the org owner", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "studio_z", name: "Z", slug: "z", plan: "studio", status: "active", ownerName: "Owner", ownerEmail: "o@z.com", clerkOrgId: "org_z" });
    await ctx.db.insert("members", { orgId: "studio_z", name: "Owner", email: "o@z.com", role: "owner", skills: [] });
  });
  await t.action(api.invites.resend, { orgId: "studio_z" });
  const invites = await t.run(async (ctx) => await ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", "studio_z")).collect());
  expect(invites.some((i) => i.status === "pending")).toBe(true);
});
```

Run: `npx vitest run convex/invites.test.ts -t "resend"` → FAIL (no `resend`).

Add to `convex/invites.ts`:

```ts
export const resend = action({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.runQuery(internal.invites._orgForResend, { orgId });
    if (!org) throw new Error("sub-account not found");
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const token = await ctx.runMutation(internal.invites.record, {
      orgId, clerkOrgId: org.clerkOrgId, agencyId: org.agencyId,
      email: org.ownerEmail, ownerName: org.ownerName, studioName: org.name,
      invitedBy: "system", emailStatus: "simulated",
    });
    const status = await sendEmail({
      to: org.ownerEmail,
      subject: inviteEmailSubject(org.name),
      html: inviteEmailHtml({ ownerName: org.ownerName, studioName: org.name,
        inviterName: "your Pulse administrator", acceptUrl: `${appUrl}/invite/${token}`,
        logoUrl: `${appUrl}/pulse-logo.png` }),
    });
    await ctx.runMutation(internal.invites.setEmailStatus, { token, emailStatus: status });
    return { inviteSent: status === "sent" };
  },
});

export const _orgForResend = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org || !org.ownerEmail || !org.ownerName) return null;
    return { name: org.name, ownerEmail: org.ownerEmail, ownerName: org.ownerName, clerkOrgId: org.clerkOrgId, agencyId: org.agencyId };
  },
});
```
Add `sendEmail` + `inviteEmail*` imports to `convex/invites.ts`.
Run: `npx vitest run convex/invites.test.ts` → PASS.

- [ ] **Step 4: Mount the button** on the sub-account detail page near the owner/status area: `<ResendInviteButton orgId={orgId} />`. Optionally show it only when an invite for the org is still `pending` (use `useQuery(api.invites.list, { orgId })`).

- [ ] **Step 5: Commit**

```bash
git add src/app/sign-up convex/invites.ts convex/invites.test.ts src/components/agency/resend-invite-button.tsx src/app/agency
git commit -m "feat(invite): invite-only sign-up + agency resend action"
```

---

## Task 9: Playwright e2e + full regression

**Files:**
- Create: `tests/e2e/invite-flow.spec.ts` (match existing e2e dir/config — confirm with `ls tests/e2e` or the `playwright.config.*`)

- [ ] **Step 1: Write the e2e**

```ts
import { test, expect } from "@playwright/test";

// Demo mode (no Clerk/Resend keys): invite screen renders from a seeded token.
test("invalid token shows the invalid state", async ({ page }) => {
  await page.goto("/invite/definitely-not-a-real-token");
  await expect(page.getByText(/invalid invitation/i)).toBeVisible();
});

test("valid token renders the account screen with locked email", async ({ page, request }) => {
  // Seed a sub-account via the agency console, or hit a test-only seed.
  // If a seed helper exists, use it; otherwise create via UI and read the token.
  // Minimal: assert the screen scaffold renders for a known seeded token.
  // (Fill in the seeded token per the project's e2e seeding approach.)
});
```

> Match the project's existing e2e seeding pattern (see other specs in `tests/e2e`). If e2e seeding isn't trivial, keep the invalid-token test as the guaranteed check and cover valid-render in the Convex unit layer.

- [ ] **Step 2: Run the e2e**

Run: `npx playwright test tests/e2e/invite-flow.spec.ts`
Expected: invalid-token test PASS.

- [ ] **Step 3: Full regression (per `feedback_regression_before_push`)**

Run, in order, and confirm each is green:
```bash
npx vitest run
npx tsc --noEmit          # or the project's typecheck script
npm run lint
npm run build
```
Expected: all pass. Fix anything that fails before continuing.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/invite-flow.spec.ts
git commit -m "test(invite): e2e invalid-token + regression green"
```

---

## Setup / Deploy Checklist (post-merge, before real sends)

- [ ] Set Convex env: `npx convex env set RESEND_API_KEY "$(op read 'op://Security/Resend Pulse/Api')"`
- [ ] Set `APP_URL` (e.g. `https://app.pulse.studio`) and `RESEND_FROM` (`Pulse <hello@pulse.studio>`) on Convex.
- [ ] Verify the Resend **sender domain** (`pulse.studio`). Until verified, Resend delivers only to the account owner's own address — fine for first tests.
- [ ] Confirm `CLERK_SECRET_KEY` is set on Convex (account creation needs the Backend API).
- [ ] Send one real invite to your own address; confirm the email renders (logo + CTA), the link lands on `/invite/<token>`, account creation completes, and you land on `/dashboard`.

---

## Completion Status (2026-05-22)

- **Tasks 1-8:** implemented + committed (see `git log` `e180e25`…`fa221ec`), plus follow-up fixes (resend authorization, real-inviter recording, a11y label, Clerk slug guard, `seedAgencyOwner` bootstrap).
- **Task 9 e2e:** Playwright is **not** part of this project's test stack (no `playwright.config`, package not installed; all Pulse testing is vitest). Per this plan's own self-review fallback, invite coverage stays at the Convex/vitest layer (`convex/invites.test.ts`, `convex/lib/email.test.ts`, `convex/lib/emailTemplates/invite.test.ts`) rather than standing up a new harness. Revisit if/when Pulse adopts Playwright.
- **Full regression (green):** `vitest` 65/65 · `tsc --noEmit` clean · `eslint` 0 errors (1 pre-existing unrelated warning in `pricing-panel.tsx`) · `next build` passes. Build/codegen requires Node 22 on PATH (`/opt/homebrew/opt/node@22/bin`) — system Node 25 is unsupported by the Convex CLI.
- **Deferred:** post-merge env/deploy checklist below (Resend domain verify, real send test); Google SSO deferred post-beta (header scope note).

## Self-Review

- **Spec coverage:** branded HTML email (Tasks 4-6), Pulse-native screen (Task 7), token model + lifecycle (Tasks 1-3), invalid/expired/accepted/already-registered states (Tasks 3, 7), invite-only sign-up + agency resend (Task 8), tests (Tasks 2-9), env carry-overs (checklist). Google SSO explicitly deferred (header scope note) — the one intentional deviation from the spec, flagged for user sign-off.
- **Placeholder scan:** the only deferred detail is the e2e valid-token seeding (Task 9), which depends on the project's existing e2e seeding convention and is bounded with a guaranteed-passing fallback.
- **Type consistency:** `lookupByToken` returns a discriminated `{state}` union used identically in Tasks 2, 3, 7. `record`/`setEmailStatus`/`markAccepted`/`accept`/`resend` signatures match between definition and callers. `emailStatus` union is identical across schema, `sendEmail` return, and mutations.
