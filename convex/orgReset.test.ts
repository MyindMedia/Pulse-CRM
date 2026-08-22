import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* Resetting a staged workspace for its real owner. The line that matters:
   what the agency BUILT survives, what never happened does not. */

const ORG = "staged-studio";

async function stagedWorkspace(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Playback", slug: "playback", plan: "studio", tier: "label",
      status: "active", agencyId: "ag1", ownerEmail: "o@x",
      onboardingCompletedAt: 1_700_000_000_000, demoMode: true,
    } as never);
    // Setup the agency built for them.
    await ctx.db.insert("rooms", { orgId: ORG, name: "Studio A", status: "available" } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "OT", email: "o@x", role: "owner", skills: [] } as never);
    await ctx.db.insert("invites", {
      orgId: ORG, email: "o@x", ownerName: "OT", studioName: "Playback", role: "owner",
      token: "tok", status: "pending", expiresAt: Date.now() + 1000, invitedBy: "sys",
      emailStatus: "sent",
    } as never);
    // History that never happened.
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Fake Client", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    } as never);
    await ctx.db.insert("sessions", {
      orgId: ORG, title: "Fake tracking", artistId, serviceType: "recording",
      startTime: Date.now(), endTime: Date.now() + 1, status: "confirmed",
      rateCents: 20000, depositCents: 0, depositPaid: true, intakeCompleted: true,
    } as never);
    await ctx.db.insert("invoices", {
      orgId: ORG, artistId, number: "INV-1", amountCents: 50000, status: "sent",
      dueDate: Date.now(), lineItems: [],
    } as never);
    await ctx.db.insert("activity", { orgId: ORG, kind: "demo", summary: "seeded" } as never);
  });
}

describe("resetting a staged workspace", () => {
  it("counts without deleting when it is not told to apply", async () => {
    const t = convexTest(schema);
    await stagedWorkspace(t);

    const dry = (await t.action(internal.orgReset._reset, { orgId: ORG })) as {
      applied: boolean;
      cleared: Record<string, number>;
      kept: Record<string, number>;
    };
    expect(dry.applied).toBe(false);
    expect(dry.cleared.sessions).toBe(1);
    expect(dry.cleared.invoices).toBe(1);
    expect(dry.kept.rooms).toBe(1);

    const sessions = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(sessions).toHaveLength(1); // still there
  });

  it("clears the history and keeps what the agency built", async () => {
    const t = convexTest(schema);
    await stagedWorkspace(t);

    const res = (await t.action(internal.orgReset._reset, { orgId: ORG, apply: true })) as {
      applied: boolean;
    };
    expect(res.applied).toBe(true);

    const [sessions, invoices, rooms, members, invites] = await t.run(async (ctx) => [
      await ctx.db.query("sessions").collect(),
      await ctx.db.query("invoices").collect(),
      await ctx.db.query("rooms").collect(),
      await ctx.db.query("members").collect(),
      await ctx.db.query("invites").collect(),
    ]);
    expect(sessions).toHaveLength(0);
    expect(invoices).toHaveLength(0);
    expect(rooms).toHaveLength(1);     // the room the agency set up
    expect(members).toHaveLength(1);   // the owner
    expect(invites).toHaveLength(1);   // deleting this would lock them out
  });

  it("sends the owner back through onboarding, on a clean slate", async () => {
    const t = convexTest(schema);
    await stagedWorkspace(t);
    await t.action(internal.orgReset._reset, { orgId: ORG, apply: true });

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.onboardingCompletedAt).toBeUndefined();
    expect(org.demoMode).toBe(false);

    // The reset itself is on the record, and it is the only thing on it.
    const activity = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity).toHaveLength(1);
    expect(activity[0].kind).toBe("account.reset");
  });

  it("touches nothing in another studio", async () => {
    const t = convexTest(schema);
    await stagedWorkspace(t);
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "someone-else", name: "Real Client", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      } as never);
      await ctx.db.insert("sessions", {
        orgId: "someone-else", title: "Real booking", artistId, serviceType: "mixing",
        startTime: Date.now(), endTime: Date.now() + 1, status: "confirmed",
        rateCents: 20000, depositCents: 0, depositPaid: true, intakeCompleted: true,
      } as never);
    });

    await t.action(internal.orgReset._reset, { orgId: ORG, apply: true });
    const left = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(left).toHaveLength(1);
    expect(left[0].orgId).toBe("someone-else");
  });

  it("refuses an orgId that does not exist", async () => {
    const t = convexTest(schema);
    await expect(
      t.action(internal.orgReset._reset, { orgId: "nope", apply: true }),
    ).rejects.toThrow();
  });
});

/* A staged workspace can hold more rows than one Convex transaction may read,
   which is how the first attempt at this died at 4,096 with the studio half
   cleared. The work is done in bites; the caller keeps calling. */
describe("clearing more than one transaction can hold", () => {
  it("keeps going until the workspace is empty", async () => {
    const t = convexTest(schema);
    await stagedWorkspace(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 250; i++) {
        await ctx.db.insert("activity", { orgId: ORG, kind: "demo", summary: `row ${i}` } as never);
      }
    });

    // A budget far below the row count, so the loop has to go round.
    let rounds = 0;
    for (;;) {
      const r = await t.mutation(internal.orgReset._resetBatch, { orgId: ORG, limit: 40 });
      rounds++;
      if (r.done) break;
      if (rounds > 50) throw new Error("did not converge");
    }
    expect(rounds).toBeGreaterThan(1);

    const left = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(left).toHaveLength(0);
  });
});
