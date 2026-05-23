import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { candidatesFor, type Signals } from "./opsBrain";
import type { Id } from "./_generated/dataModel";

const ORG = "org_brain";

function emptySignals(over: Partial<Signals>): Signals {
  return {
    now: Date.now(),
    orgName: "Test Studio",
    quietArtists: [],
    overdueInvoices: [],
    unconfirmedSessions: [],
    depositUnpaid: [],
    revisionOverflow: [],
    splitSheetChase: [],
    underusedRooms: [],
    newLeads: [],
    upcomingPrep: [],
    recentlyCompleted: [],
    revisionTriage: [],
    rightsMetadataGaps: [],
    pricingRooms: [],
    noShowRisks: [],
    weakLeadSources: [],
    ...over,
  };
}

describe("candidatesFor (pure rule layer)", () => {
  it("maps a quiet artist with an email to a reengage email action", () => {
    const out = candidatesFor(
      emptySignals({ quietArtists: [{ id: "a1" as Id<"artists">, name: "Nova Reign", email: "nova@x.com" }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("reengage_quiet_artist");
    expect(out[0].priority).toBe("medium");
    expect(out[0].entityId).toBe("a1");
    expect(out[0].payload.kind).toBe("email");
  });

  it("falls back to note_only when the artist has no email", () => {
    const out = candidatesFor(
      emptySignals({ quietArtists: [{ id: "a2" as Id<"artists">, name: "No Email" }] }),
    );
    expect(out[0].payload.kind).toBe("note_only");
  });

  it("maps an overdue invoice to a high-priority payment reminder", () => {
    const out = candidatesFor(
      emptySignals({
        overdueInvoices: [{ id: "i1" as Id<"invoices">, number: "INV-9", amountCents: 25000, artistName: "Bishop Grey", email: "b@x.com" }],
      }),
    );
    expect(out[0].type).toBe("payment_reminder");
    expect(out[0].priority).toBe("high");
    if (out[0].payload.kind === "email") expect(out[0].payload.subject).toContain("INV-9");
  });

  it("maps an unconfirmed session to a session_status confirm payload", () => {
    const out = candidatesFor(
      emptySignals({
        unconfirmedSessions: [{ id: "s1" as Id<"sessions">, title: "Vocal day", startTime: Date.now() + 3600_000, artistName: "Aria" }],
      }),
    );
    expect(out[0].type).toBe("confirm_unconfirmed_session");
    expect(out[0].payload).toEqual({ kind: "session_status", sessionId: "s1", newStatus: "confirmed" });
  });
});

describe("scanOrg (gather -> candidates -> upsert + dedupe)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedQuietArtistAndOverdueInvoice() {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Brain Co", slug: "brain", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Quiet One", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 1, reliability: "solid",
        email: "quiet@x.com", lastContactAt: Date.now() - 120 * 86_400_000,
      });
      await ctx.db.insert("invoices", {
        orgId: ORG, number: "INV-1", artistId, status: "overdue",
        lineItems: [{ label: "Mix", amountCents: 30000 }], amountCents: 30000,
        dueDate: Date.now() - 5 * 86_400_000,
      });
    });
  }

  it("creates one action per signal and dedupes on re-scan", async () => {
    await seedQuietArtistAndOverdueInvoice();

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    let rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === ORG),
    );
    expect(rows).toHaveLength(2);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(["payment_reminder", "reengage_quiet_artist"]);

    // Re-scan must not create duplicates while the rows are still open.
    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === ORG),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("scanOrg - named agents end-to-end", () => {
  let t: ReturnType<typeof convexTest>;
  const AGENT_ORG = "org_agents";
  beforeEach(() => { t = convexTest(schema); });

  function rowOf(rows: { type: string; dedupeKey: string; entityId?: string }[], type: string) {
    return rows.find((r) => r.type === type);
  }

  it("Booking Conversion: a never-booked lead yields a convert_lead row", async () => {
    const leadId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: AGENT_ORG, name: "Agents Co", slug: "agents", plan: "studio", status: "active" });
      return ctx.db.insert("artists", {
        orgId: AGENT_ORG, name: "Fresh Lead", type: "artist", genres: ["pop"], tags: [],
        status: "lead", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
        email: "lead@x.com", source: "instagram",
      });
    });
    await t.mutation(internal.opsBrain.scanOrg, { orgId: AGENT_ORG });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === AGENT_ORG),
    );
    const r = rowOf(rows, "convert_lead");
    expect(r).toBeTruthy();
    expect(r!.entityId).toBe(leadId);
    expect(r!.dedupeKey).toBe(`convert_lead:${leadId}`);
  });

  it("Post-Session Recap: a just-completed session yields a post_session_recap row", async () => {
    const sessionId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: AGENT_ORG, name: "Agents Co", slug: "agents", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: AGENT_ORG, name: "Recap Artist", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 1, reliability: "solid", email: "r@x.com",
      });
      return ctx.db.insert("sessions", {
        orgId: AGENT_ORG, title: "Tracking", artistId, serviceType: "recording",
        startTime: Date.now() - 7200_000, endTime: Date.now() - 3600_000, status: "completed",
        rateCents: 20000, depositCents: 5000, depositPaid: true, intakeCompleted: true,
      });
    });
    await t.mutation(internal.opsBrain.scanOrg, { orgId: AGENT_ORG });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === AGENT_ORG),
    );
    const r = rowOf(rows, "post_session_recap");
    expect(r).toBeTruthy();
    expect(r!.entityId).toBe(sessionId);
    expect(r!.dedupeKey).toBe(`post_session_recap:${sessionId}`);
  });

  it("Session Prep + No-show: an upcoming flagged-artist session yields both rows", async () => {
    const sessionId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: AGENT_ORG, name: "Agents Co", slug: "agents", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: AGENT_ORG, name: "Flaky", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 1, reliability: "flagged", email: "f@x.com",
      });
      return ctx.db.insert("sessions", {
        orgId: AGENT_ORG, title: "Upcoming", artistId, serviceType: "mixing",
        startTime: Date.now() + 3600_000, endTime: Date.now() + 7200_000, status: "confirmed",
        rateCents: 20000, depositCents: 5000, depositPaid: false, intakeCompleted: true,
      });
    });
    await t.mutation(internal.opsBrain.scanOrg, { orgId: AGENT_ORG });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === AGENT_ORG),
    );
    expect(rowOf(rows, "session_prep_packet")?.entityId).toBe(sessionId);
    expect(rowOf(rows, "no_show_risk")?.entityId).toBe(sessionId);
  });

  it("Revision Triage: a deliverable with 3+ open notes yields a revision_triage row", async () => {
    const songId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: AGENT_ORG, name: "Agents Co", slug: "agents", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: AGENT_ORG, name: "Writer", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 1, reliability: "solid",
      });
      const sId = await ctx.db.insert("songs", {
        orgId: AGENT_ORG, title: "Skyline", artistId, kind: "single", stage: "mixing",
        moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 1,
      });
      const dId = await ctx.db.insert("deliverables", {
        orgId: AGENT_ORG, songId: sId, kind: "mix", version: 3, label: "Mix v3",
        status: "in_review", paymentGated: false,
      });
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("revisionComments", {
          orgId: AGENT_ORG, songId: sId, deliverableId: dId, timestampSec: i * 30,
          body: `note ${i}`, authorName: "Lee", resolved: false,
        });
      }
      return sId;
    });
    await t.mutation(internal.opsBrain.scanOrg, { orgId: AGENT_ORG });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === AGENT_ORG),
    );
    const r = rowOf(rows, "revision_triage");
    expect(r).toBeTruthy();
    expect(r!.entityId).toBe(songId);
    expect(r!.dedupeKey).toBe(`revision_triage:${songId}`);
  });
});
