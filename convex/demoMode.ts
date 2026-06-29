import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Id, TableNames } from "./_generated/dataModel";
import { resolveViewer } from "./lib/access";

/* ============================================================
   Demo mode - the agency-side switch that fills a sub-account
   with believable demo data for pitches, then wipes it clean
   for go-live.

   Every row the filler inserts is recorded in the `demoRows`
   registry, so switching back to live deletes EXACTLY what the
   demo added - the studio's real configuration (branding, rooms,
   gear, team, Stripe) is never touched. If the org has no rooms
   or team yet, the filler creates demo ones (also registered, so
   they vanish on go-live too).
   ============================================================ */

const DAY = 86_400_000;
const HOUR = 3_600_000;

async function requireAgencyOverOrg(ctx: MutationCtx, orgId: string) {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind !== "agency_member") {
    throw new ConvexError("Demo mode is controlled from the agency console.");
  }
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!org) throw new ConvexError("Sub-account not found.");
  // Treat an orphan org (no agencyId) as a mismatch so an agency member can't
  // act on a sub-account that isn't under their agency.
  if (org.agencyId !== viewer.agencyId) {
    throw new ConvexError("This sub-account belongs to a different agency.");
  }
  return org;
}

/** Insert + register so clearDemo can remove it precisely. */
async function put<T extends TableNames>(
  ctx: MutationCtx,
  orgId: string,
  table: T,
  doc: Record<string, unknown>,
): Promise<Id<T>> {
  const id = (await ctx.db.insert(table as never, doc as never)) as Id<T>;
  await ctx.db.insert("demoRows", { orgId, table, docId: id as string });
  return id;
}

export const status = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    // Agency-console read: only an agency member of THIS org's agency may see
    // demo state (previously it trusted orgId from args and leaked to anyone).
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!org || viewer?.kind !== "agency_member" || org.agencyId !== viewer.agencyId) {
      return { demoMode: false, demoRowCount: 0 };
    }
    const count = (
      await ctx.db.query("demoRows").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).length;
    return { demoMode: Boolean(org?.demoMode), demoRowCount: count };
  },
});

/** The agency toggle. demo=true fills; demo=false wipes demo rows clean. */
export const setDemoMode = mutation({
  args: { orgId: v.string(), demo: v.boolean() },
  handler: async (ctx, { orgId, demo }) => {
    const org = await requireAgencyOverOrg(ctx, orgId);
    if (demo === Boolean(org.demoMode)) return { demoMode: demo, changed: false };
    if (demo) {
      await fillDemo(ctx, orgId);
    } else {
      await clearDemo(ctx, orgId);
    }
    await ctx.db.patch(org._id, { demoMode: demo });
    return { demoMode: demo, changed: true };
  },
});

/** Stage a sub-account for owner onboarding: wipe all demo rows, keep the
    branded configuration (logo, colors, rooms, team), and reset the
    onboarding flag so the owner's first login walks the premium /welcome
    wizard against a clean slate. */
export const stageForOnboarding = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await requireAgencyOverOrg(ctx, orgId);
    const removed = await clearDemo(ctx, orgId);
    await ctx.db.patch(org._id, { demoMode: false, onboardingCompletedAt: undefined });
    return { removed };
  },
});

/** Internal fill for the staged-demo pipeline (auth handled by the caller). */
export const fillInternal = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new ConvexError("Org not found.");
    if (org.demoMode) return;
    await fillDemo(ctx, orgId);
    await ctx.db.patch(org._id, { demoMode: true });
  },
});

async function clearDemo(ctx: MutationCtx, orgId: string) {
  const rows = await ctx.db
    .query("demoRows")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const r of rows) {
    try {
      await ctx.db.delete(r.docId as Id<TableNames>);
    } catch {
      // already deleted by hand - fine
    }
    await ctx.db.delete(r._id);
  }
  return rows.length;
}

/* ── The demo dataset ─────────────────────────────────────────── */

const ARTISTS = [
  { name: "Nova Reign", type: "artist", genres: ["R&B", "Pop"], status: "active", ltv: 740000, sessions: 9, instagram: "@novareign" },
  { name: "Bishop Grey", type: "artist", genres: ["Hip hop"], status: "active", ltv: 412000, sessions: 5, instagram: "@bishopgrey" },
  { name: "Aurora Sky", type: "artist", genres: ["Indie", "Dream pop"], status: "dormant", ltv: 268000, sessions: 4, instagram: "@auroraskymusic" },
  { name: "Marcos Vela", type: "producer", genres: ["Latin", "Reggaeton"], status: "active", ltv: 530000, sessions: 7, instagram: "@marcosvela" },
  { name: "Lauren Page", type: "artist", genres: ["Soul"], status: "lead", ltv: 86000, sessions: 1, instagram: "@laurenpagemusic" },
] as const;

async function fillDemo(ctx: MutationCtx, orgId: string) {
  const now = Date.now();

  // Rooms: lean on the studio's REAL configured rooms; only conjure demo
  // rooms when none exist yet.
  let rooms = (
    await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
  ).filter((r) => r.status !== "retired");
  if (rooms.length === 0) {
    const a = await put(ctx, orgId, "rooms", {
      orgId, name: "Studio A", roomType: "Live room", status: "available",
      hourlyRateCents: 15000, minimumHours: 2, depositPct: 30, bookable: true,
    });
    const b = await put(ctx, orgId, "rooms", {
      orgId, name: "Mix Suite", roomType: "Mix suite", status: "available",
      hourlyRateCents: 9000, minimumHours: 2, depositPct: 30, bookable: true,
    });
    rooms = [(await ctx.db.get(a))!, (await ctx.db.get(b))!];
  }

  // Engineers: real team if present, demo engineers otherwise.
  let crew = (
    await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
  ).filter((m) => m.role === "engineer" || m.role === "owner");
  if (crew.length === 0) {
    const e1 = await put(ctx, orgId, "members", {
      orgId, name: "Renzo Diaz", role: "engineer", avatarColor: "#ff5d5d", skills: ["Tracking", "Mixing"],
    });
    const e2 = await put(ctx, orgId, "members", {
      orgId, name: "Sienna Cole", role: "engineer", avatarColor: "#c084fc", skills: ["Vocal production"],
    });
    crew = [(await ctx.db.get(e1))!, (await ctx.db.get(e2))!];
  }

  // Artists + songs.
  const artistIds: Id<"artists">[] = [];
  for (const [i, a] of ARTISTS.entries()) {
    artistIds.push(
      await put(ctx, orgId, "artists", {
        orgId, name: a.name, type: a.type,
        email: `${a.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        genres: [...a.genres], tags: ["demo"], instagram: a.instagram,
        status: a.status, lifetimeValueCents: a.ltv, sessionCount: a.sessions,
        reliability: (["solid", "solid", "watch"] as const)[i % 3], lastContactAt: now - (i + 1) * 2 * DAY,
      }),
    );
  }
  const songIds: Id<"songs">[] = [];
  const SONGS = [
    { title: "Golden Hour", artist: 0, stage: "mixing", genre: "R&B", bpm: 92 },
    { title: "Neon Rain", artist: 0, stage: "mastering", genre: "Pop", bpm: 104 },
    { title: "Concrete Halo", artist: 1, stage: "tracking", genre: "Hip hop", bpm: 140 },
    { title: "Salt & Smoke", artist: 2, stage: "writing", genre: "Indie", bpm: 76 },
  ] as const;
  for (const s of SONGS) {
    songIds.push(
      await put(ctx, orgId, "songs", {
        orgId, title: s.title, artistId: artistIds[s.artist], kind: "single",
        stage: s.stage, genre: s.genre, bpm: s.bpm, moodTags: [], referenceTracks: [],
        revisionsIncluded: 3, revisionsUsed: s.stage === "mixing" ? 2 : 0,
      }),
    );
  }

  // Sessions across the timeline, on REAL rooms, with payments.
  const room = (i: number) => rooms[i % rooms.length];
  const eng = (i: number) => crew[i % crew.length];
  const mkSession = async (cfg: {
    title: string; artist: number; song?: number; offsetDays: number; hour: number;
    duration: number; status: string; rate: number; paidPct: 0 | 0.3 | 1; i: number;
  }) => {
    const start = new Date(now + cfg.offsetDays * DAY);
    start.setHours(cfg.hour, 0, 0, 0);
    const paid = Math.round(cfg.rate * cfg.paidPct);
    const sessionId = await put(ctx, orgId, "sessions", {
      orgId, title: cfg.title, artistId: artistIds[cfg.artist],
      songId: cfg.song !== undefined ? songIds[cfg.song] : undefined,
      serviceType: "recording", roomId: room(cfg.i)._id, engineerId: eng(cfg.i)._id,
      startTime: start.getTime(), endTime: start.getTime() + cfg.duration * HOUR,
      status: cfg.status, rateCents: cfg.rate, intakeCompleted: cfg.status !== "tentative",
      depositCents: Math.round(cfg.rate * 0.3),
      depositPaid: cfg.paidPct > 0, amountPaidCents: paid > 0 ? paid : undefined,
      source: "demo",
    });
    if (paid > 0) {
      await put(ctx, orgId, "payments", {
        orgId, sessionId, kind: cfg.paidPct === 1 ? "full" : "deposit",
        amountCents: paid, provider: "simulated", status: "paid",
        reference: `DEMO-${cfg.i}${Date.now() % 100000}`,
        payerName: ARTISTS[cfg.artist].name, paidAt: start.getTime() - 2 * DAY,
      });
    }
    return sessionId;
  };

  const sessions = [
    { title: "Golden Hour - vocal comp", artist: 0, song: 0, offsetDays: -9, hour: 14, duration: 4, status: "completed", rate: 60000, paidPct: 1 },
    { title: "Concrete Halo - tracking", artist: 1, song: 2, offsetDays: -6, hour: 18, duration: 6, status: "completed", rate: 90000, paidPct: 1 },
    { title: "Salt & Smoke - writing day", artist: 2, song: 3, offsetDays: -3, hour: 11, duration: 5, status: "completed", rate: 45000, paidPct: 1 },
    { title: "Neon Rain - mix review", artist: 0, song: 1, offsetDays: 0, hour: 13, duration: 3, status: "in_progress", rate: 45000, paidPct: 1 },
    { title: "Vela - reggaeton session", artist: 3, offsetDays: 1, hour: 16, duration: 4, status: "confirmed", rate: 60000, paidPct: 0.3 },
    { title: "Lauren Page - first session", artist: 4, offsetDays: 2, hour: 12, duration: 3, status: "confirmed", rate: 45000, paidPct: 0.3 },
    { title: "Bishop Grey - overdubs", artist: 1, song: 2, offsetDays: 4, hour: 15, duration: 4, status: "tentative", rate: 60000, paidPct: 0 },
  ] as const;
  for (const [i, s] of sessions.entries()) {
    await mkSession({ ...s, i });
  }

  // Invoices: one of each state the Payments page shows.
  const mkInvoice = (cfg: {
    number: string; artist: number; song?: number; label: string; amount: number;
    status: string; dueOffsetDays: number; paidOffsetDays?: number;
  }) =>
    put(ctx, orgId, "invoices", {
      orgId, number: cfg.number, artistId: artistIds[cfg.artist],
      songId: cfg.song !== undefined ? songIds[cfg.song] : undefined,
      status: cfg.status, lineItems: [{ label: cfg.label, amountCents: cfg.amount }],
      amountCents: cfg.amount, dueDate: now + cfg.dueOffsetDays * DAY,
      paidAt: cfg.paidOffsetDays !== undefined ? now + cfg.paidOffsetDays * DAY : undefined,
    });
  await mkInvoice({ number: "DMO-1041", artist: 0, song: 1, label: "Neon Rain - full production", amount: 320000, status: "paid", dueOffsetDays: -20, paidOffsetDays: -24 });
  await mkInvoice({ number: "DMO-1042", artist: 1, song: 2, label: "Concrete Halo - tracking block", amount: 180000, status: "sent", dueOffsetDays: 9 });
  await mkInvoice({ number: "DMO-1043", artist: 2, label: "Writing camp - 2 days", amount: 90000, status: "overdue", dueOffsetDays: -6 });
  await mkInvoice({ number: "DMO-1044", artist: 3, label: "Mix + master bundle", amount: 150000, status: "draft", dueOffsetDays: 14 });

  // Pipeline.
  const OPPS = [
    { title: "Bishop Grey - debut EP", artist: 1, stage: "inquiry", value: 480000, probability: 0.15 },
    { title: "Nova Reign - album block", artist: 0, stage: "qualified", value: 960000, probability: 0.4 },
    { title: "Vela - mix bundle x3", artist: 3, stage: "proposal", value: 270000, probability: 0.6 },
    { title: "Lauren Page - vocal package", artist: 4, stage: "booked", value: 135000, probability: 1 },
  ] as const;
  for (const [i, o] of OPPS.entries()) {
    await put(ctx, orgId, "opportunities", {
      orgId, title: o.title, artistId: artistIds[o.artist], stage: o.stage,
      valueCents: o.value, serviceType: "recording", probability: o.probability,
      source: "Instagram DM", updatedAt: now - i * DAY,
    });
  }

  // Insights for the bell + alerts.
  await put(ctx, orgId, "insights", {
    orgId, kind: "risk", severity: "warning",
    title: "Aurora Sky has gone quiet",
    body: "No session in 30 days and an invoice 6 days overdue. Send a re-engagement note with a payment link.",
    entityType: "artist", entityId: artistIds[2], status: "new",
  });
  await put(ctx, orgId, "insights", {
    orgId, kind: "revenue", severity: "opportunity",
    title: "Nova Reign is trending toward an album block",
    body: "Three sessions in two weeks and an open album opportunity. Propose a discounted 40-hour block while momentum is high.",
    entityType: "artist", entityId: artistIds[0], status: "new",
  });

  // A touch of activity so feeds look alive.
  const ACTIVITY = [
    { kind: "payment.received", summary: "$600 deposit cleared - Vela reggaeton session", accent: "positive" },
    { kind: "booking.created", summary: "New booking request - Lauren Page, first session", accent: "info" },
    { kind: "invoice.sent", summary: "Invoice DMO-1042 sent to Bishop Grey", accent: "info" },
  ] as const;
  for (const a of ACTIVITY) {
    await put(ctx, orgId, "activity", {
      orgId, kind: a.kind, summary: a.summary, accent: a.accent,
    });
  }
}
