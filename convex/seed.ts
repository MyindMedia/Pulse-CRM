import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { DEMO_ORG } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   PULSE - demo seed
   Populates the "pulse-demo" workspace with one believable
   recording studio's worth of data so the whole app is
   explorable with zero setup. Idempotent: wipes demo rows
   then rebuilds. Run from the Convex dashboard or:
     npx convex run seed:run
   ============================================================ */

const DAY = 86_400_000;
const HOUR = 3_600_000;

// Tables wiped + rebuilt on every seed run.
const TABLES = [
  "orgs",
  "members",
  "rooms",
  "equipment",
  "artists",
  "songs",
  "sessions",
  "engineeringLogs",
  "deliverables",
  "revisionComments",
  "splitSheets",
  "invoices",
  "opportunities",
  "syncOpportunities",
  "releaseCampaigns",
  "licenses",
  "activity",
  "insights",
] as const;

export const run = mutation({
  // orgId optional: defaults to the seed demo workspace. Pass a real
  // sub-account's orgId to turn IT into a populated demo while KEEPING its Clerk
  // org + agency link intact (so prospects can actually log in).
  args: { orgId: v.optional(v.string()), studioName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? DEMO_ORG;
    // Destructive wipe+reseed: require owner/manager on the TARGET org. Blocks
    // unauthenticated callers AND stops one org's member from wiping another by
    // passing its id (requireCapability validates the org belongs to the
    // caller). The seeded DEMO_ORG owner holds this in Clerk-disabled demo mode.
    await requireCapability(ctx, "members.remove", { orgId });
    const preserveOrg = orgId !== DEMO_ORG; // keep the real org's identity fields
    const now = Date.now();

    // ── Wipe existing data for this org (content only; keep the real org row so
    //    clerkOrgId/agencyId/slug survive). ──
    for (const table of TABLES) {
      if (table === "orgs" && preserveOrg) continue;
      const rows = await ctx.db
        .query(table)
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }

    // ── Org ── for a real sub-account, KEEP its own branding (name, accent,
    //    tagline, logo, clerkOrgId, agencyId, slug) - only mark onboarding done
    //    so the nudge doesn't show. A studioName may be passed to rename it.
    if (preserveOrg) {
      const existing = await ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          onboardingCompletedAt: now,
          // studioName = set this org's demo identity (name + drop any seed
          // tagline); without it, the org keeps its own branding untouched.
          ...(args.studioName ? { name: args.studioName, tagline: "" } : {}),
        });
      } else {
        await ctx.db.insert("orgs", {
          orgId, name: args.studioName ?? "Lumen Recording Co.", slug: "lumen-recording",
          plan: "studio", accentColor: "#fdb913",
        });
      }
    } else {
      await ctx.db.insert("orgs", {
        orgId,
        name: "Lumen Recording Co.",
        slug: "lumen-recording",
        plan: "studio",
        accentColor: "#fdb913",
        tagline: "Where the record gets made.",
      });
    }

    // ── Members ──
    const member = async (
      name: string,
      role: "owner" | "manager" | "engineer",
      skills: string[],
      avatarColor: string,
    ) => ctx.db.insert("members", { orgId, name, role, skills, avatarColor });

    await member("Marcus Vale", "owner", ["A&R", "Mixing"], "#fdb913");
    const jada = await member("Jada Brooks", "manager", ["Bookings", "Client care"], "#5db4ff");
    const theo = await member("Theo Park", "engineer", ["Neve-certified", "Tracking"], "#3ddc91");
    const renzo = await member("Renzo Diaz", "engineer", ["Vocal tuning", "Pro Tools"], "#ff5d5d");
    const sienna = await member("Sienna Cole", "engineer", ["Mixing", "Dolby Atmos"], "#c084fc");

    // ── Rooms - the bookable studios ──
    const room = async (
      name: string,
      roomType: string,
      hourlyRateCents: number,
      status: "available" | "in_use" | "maintenance" | "retired",
      minimumHours: number,
      depositPct: number,
      condition?: string,
      heroImageUrl?: string,
    ) =>
      ctx.db.insert("rooms", {
        orgId,
        name,
        roomType,
        hourlyRateCents,
        status,
        minimumHours,
        depositPct,
        bookable: true,
        condition,
        heroImageUrl,
      });

    const studioA = await room("Studio A - Live Room", "Live room", 15000, "in_use", 3, 30, "Flagship tracking room", "/rooms/studio-a-live-room.png");
    const studioB = await room("Studio B - Mix Suite", "Mix suite", 9500, "available", 2, 30, "Atmos-ready", "/rooms/studio-b-mix-suite.png");
    const writeRoom = await room("The Loft - Writing Room", "Writing room", 6000, "available", 2, 25, undefined, "/rooms/the-loft-writing-room.png");

    // ── Equipment - gear assets. Some installed in a room (availability
    //    follows the room), some standing alone in storage. Every item
    //    carries a purchase price and a current value. ──
    const equip = async (cfg: {
      name: string;
      category: "console" | "mic" | "outboard" | "instrument" | "monitor" | "rig" | "other";
      purchaseCents: number;
      currentValueCents: number;
      room?: typeof studioA;
      status?: "available" | "in_use" | "maintenance" | "retired";
      condition?: string;
      serialNumber?: string;
      photoSlug?: string;
    }) =>
      ctx.db.insert("equipment", {
        orgId,
        name: cfg.name,
        category: cfg.category,
        installedInRoomId: cfg.room,
        status: cfg.status ?? "available",
        purchaseCents: cfg.purchaseCents,
        currentValueCents: cfg.currentValueCents,
        condition: cfg.condition,
        serialNumber: cfg.serialNumber,
        // Demo gear ships with a per-item photo; real items upload their own.
        photoUrl: cfg.photoSlug
          ? `/gear/items/${cfg.photoSlug}.png`
          : `/gear/${cfg.category}.png`,
      });

    // Installed in Studio A
    await equip({ name: "Neve 8068 Console", category: "console", purchaseCents: 8_500_000, currentValueCents: 11_200_000, room: studioA, condition: "Recapped 2024", serialNumber: "NV8068-0142", photoSlug: "neve-8068-console" });
    await equip({ name: "Telefunken U47", category: "mic", purchaseCents: 1_100_000, currentValueCents: 1_450_000, room: studioA, condition: "Vintage, serviced quarterly", photoSlug: "telefunken-u47" });
    await equip({ name: "Pro Tools HDX Rig", category: "rig", purchaseCents: 1_800_000, currentValueCents: 950_000, room: studioA, photoSlug: "pro-tools-hdx-rig" });
    await equip({ name: "Yamaha C7 Grand Piano", category: "instrument", purchaseCents: 4_200_000, currentValueCents: 4_600_000, room: studioA, condition: "Tuned monthly", photoSlug: "yamaha-c7-grand-piano" });
    // Installed in Studio B
    await equip({ name: "Genelec 8351B Pair", category: "monitor", purchaseCents: 720_000, currentValueCents: 540_000, room: studioB, photoSlug: "genelec-8351b-pair" });
    await equip({ name: "1176 Compressor Pair", category: "outboard", purchaseCents: 560_000, currentValueCents: 620_000, room: studioB, condition: "Channel 2 intermittent", photoSlug: "1176-compressor-pair" });
    await equip({ name: "Lavry Gold Converter", category: "outboard", purchaseCents: 480_000, currentValueCents: 300_000, room: studioB, photoSlug: "lavry-gold-converter" });
    // Installed in the writing room
    await equip({ name: "Nord Stage 4", category: "instrument", purchaseCents: 480_000, currentValueCents: 410_000, room: writeRoom, photoSlug: "nord-stage-4" });
    // In storage
    await equip({ name: "AKG C414 (x2)", category: "mic", purchaseCents: 220_000, currentValueCents: 180_000, condition: "Spare pair", photoSlug: "akg-c414" });
    await equip({ name: "Fender Twin Reverb", category: "instrument", purchaseCents: 180_000, currentValueCents: 240_000, condition: "Vintage 1974", photoSlug: "fender-twin-reverb" });
    await equip({ name: "Distressor EL8 Pair", category: "outboard", purchaseCents: 360_000, currentValueCents: 340_000, status: "maintenance", condition: "Awaiting service", photoSlug: "distressor-el8-pair" });
    await equip({ name: "Shure SM7B (x3)", category: "mic", purchaseCents: 120_000, currentValueCents: 105_000, photoSlug: "shure-sm7b" });

    // ── Artists ──
    const artist = async (cfg: {
      name: string;
      type: "artist" | "producer" | "band" | "label" | "songwriter" | "other";
      status: "lead" | "active" | "dormant" | "vip";
      genres: string[];
      tags: string[];
      reliability: "solid" | "watch" | "flagged";
      ltv: number;
      sessions: number;
      email?: string;
      location?: string;
      instagram?: string;
      lastContactDays?: number;
    }) =>
      ctx.db.insert("artists", {
        orgId,
        name: cfg.name,
        type: cfg.type,
        email: cfg.email,
        location: cfg.location,
        genres: cfg.genres,
        tags: cfg.tags,
        avatarColor: undefined,
        instagram: cfg.instagram,
        status: cfg.status,
        lifetimeValueCents: cfg.ltv,
        sessionCount: cfg.sessions,
        reliability: cfg.reliability,
        lastContactAt: now - (cfg.lastContactDays ?? 3) * DAY,
      });

    const nova = await artist({
      name: "Nova Reign", type: "artist", status: "vip", genres: ["R&B", "Soul"],
      tags: ["Marquee", "Sync-ready"], reliability: "solid", ltv: 4_280_000, sessions: 14,
      email: "nova@novareign.com", location: "Atlanta, GA", instagram: "@novareign", lastContactDays: 1,
    });
    const midnight = await artist({
      name: "The Midnight Tape", type: "band", status: "active", genres: ["Indie Rock"],
      tags: ["Album in progress"], reliability: "solid", ltv: 2_640_000, sessions: 9,
      email: "booking@themidnighttape.com", location: "Nashville, TN", lastContactDays: 2,
    });
    const kairo = await artist({
      name: "Kairo", type: "producer", status: "active", genres: ["Hip-Hop", "Trap"],
      tags: ["Beat catalog"], reliability: "solid", ltv: 1_910_000, sessions: 11,
      email: "kairo@kairobeats.com", location: "Houston, TX", instagram: "@kairobeats", lastContactDays: 4,
    });
    const lila = await artist({
      name: "Lila Ferrari", type: "songwriter", status: "active", genres: ["Pop", "Country"],
      tags: ["Topline", "Sync-ready"], reliability: "solid", ltv: 980_000, sessions: 6,
      email: "lila@lilaferrari.com", location: "Los Angeles, CA", lastContactDays: 6,
    });
    const pulsewave = await artist({
      name: "DJ Pulsewave", type: "producer", status: "vip", genres: ["EDM", "House"],
      tags: ["Marquee"], reliability: "solid", ltv: 3_120_000, sessions: 8,
      email: "mgmt@pulsewave.fm", location: "Miami, FL", lastContactDays: 5,
    });
    const sage = await artist({
      name: "Sage Monroe", type: "artist", status: "active", genres: ["Soul", "Jazz"],
      tags: [], reliability: "solid", ltv: 720_000, sessions: 5,
      email: "sage@sagemonroe.com", location: "Chicago, IL", lastContactDays: 8,
    });
    const bishop = await artist({
      name: "Bishop Grey", type: "artist", status: "lead", genres: ["Drill", "Hip-Hop"],
      tags: ["New inquiry"], reliability: "watch", ltv: 0, sessions: 0,
      email: "bishop.grey@gmail.com", location: "Brooklyn, NY", lastContactDays: 2,
    });
    const aurora = await artist({
      name: "Aurora Sky", type: "artist", status: "dormant", genres: ["Pop"],
      tags: ["Re-engage"], reliability: "watch", ltv: 1_140_000, sessions: 7,
      email: "aurora@auroraskymusic.com", location: "Seattle, WA", lastContactDays: 124,
    });
    const crosstown = await artist({
      name: "Crosstown Records", type: "label", status: "vip", genres: ["Multi-genre"],
      tags: ["Marquee", "Volume"], reliability: "solid", ltv: 6_750_000, sessions: 21,
      email: "studio@crosstownrecords.com", location: "Atlanta, GA", lastContactDays: 3,
    });
    const echo = await artist({
      name: "Echo & the Drift", type: "band", status: "lead", genres: ["Dream Pop"],
      tags: ["New inquiry"], reliability: "solid", ltv: 0, sessions: 0,
      email: "hello@echoandthedrift.com", location: "Portland, OR", lastContactDays: 1,
    });
    const tomas = await artist({
      name: "Tomás Vela", type: "artist", status: "active", genres: ["Latin", "Reggaeton"],
      tags: [], reliability: "solid", ltv: 1_360_000, sessions: 6,
      email: "tomas@tomasvela.com", location: "Austin, TX", lastContactDays: 9,
    });
    const mira = await artist({
      name: "Mira Quartz", type: "artist", status: "lead", genres: ["Alt-Pop"],
      tags: ["New inquiry"], reliability: "solid", ltv: 0, sessions: 0,
      email: "mira@miraquartz.com", location: "Denver, CO", lastContactDays: 4,
    });

    // ── Songs ──
    const song = async (cfg: {
      title: string;
      artistId: typeof nova;
      kind: "single" | "album_track" | "beat" | "spec" | "ep";
      stage:
        | "writing" | "demo" | "tracking" | "editing"
        | "mixing" | "mastering" | "delivered" | "released";
      genre?: string;
      bpm?: number;
      musicalKey?: string;
      mode?: string;
      moodTags?: string[];
      brief?: string;
      isrc?: string;
      revisionsIncluded?: number;
      revisionsUsed?: number;
      specStatus?: "idea" | "demo" | "shopped" | "pitched" | "picked_up" | "shelved";
      streamCount?: number;
    }) =>
      ctx.db.insert("songs", {
        orgId,
        title: cfg.title,
        artistId: cfg.artistId,
        kind: cfg.kind,
        stage: cfg.stage,
        genre: cfg.genre,
        bpm: cfg.bpm,
        musicalKey: cfg.musicalKey,
        mode: cfg.mode,
        moodTags: cfg.moodTags ?? [],
        referenceTracks: [],
        isrc: cfg.isrc,
        revisionsIncluded: cfg.revisionsIncluded ?? 3,
        revisionsUsed: cfg.revisionsUsed ?? 0,
        specStatus: cfg.specStatus,
        streamCount: cfg.streamCount,
      });

    const sGoldenHour = await song({
      title: "Golden Hour", artistId: nova, kind: "single", stage: "mixing",
      genre: "R&B", bpm: 92, musicalKey: "F#", mode: "Minor",
      moodTags: ["warm", "nocturnal", "intimate"], revisionsIncluded: 4, revisionsUsed: 2,
      brief: "Late-night R&B single - Anderson .Paak warmth with a modern low end.",
    });
    const sNeonRain = await song({
      title: "Neon Rain", artistId: nova, kind: "single", stage: "released",
      genre: "R&B", bpm: 84, musicalKey: "C", mode: "Minor",
      isrc: "USMYS2600114", streamCount: 412_900, moodTags: ["moody", "cinematic"],
    });
    const sParadise = await song({
      title: "Paradise Static", artistId: midnight, kind: "album_track", stage: "tracking",
      genre: "Indie Rock", bpm: 138, musicalKey: "A", mode: "Major", moodTags: ["driving", "bright"],
    });
    const sHalflight = await song({
      title: "Halflight", artistId: midnight, kind: "album_track", stage: "editing",
      genre: "Indie Rock", bpm: 120, musicalKey: "D", mode: "Major", moodTags: ["wistful"],
    });
    const sLowOrbit = await song({
      title: "Low Orbit", artistId: kairo, kind: "beat", stage: "delivered",
      genre: "Trap", bpm: 144, musicalKey: "G", mode: "Minor", moodTags: ["dark", "spacious"],
    });
    const sCarbon = await song({
      title: "Carbon", artistId: kairo, kind: "beat", stage: "mastering",
      genre: "Hip-Hop", bpm: 150, musicalKey: "E", mode: "Minor", moodTags: ["hard", "minimal"],
    });
    const sFirstLight = await song({
      title: "First Light", artistId: lila, kind: "spec", stage: "demo",
      genre: "Pop", bpm: 110, musicalKey: "C", mode: "Major", specStatus: "shopped",
      moodTags: ["uplifting", "sync-ready"],
      brief: "Optimistic pop topline written on spec - targeting brand sync.",
    });
    const sAfterglow = await song({
      title: "Afterglow", artistId: pulsewave, kind: "single", stage: "mastering",
      genre: "House", bpm: 124, musicalKey: "A", mode: "Minor", moodTags: ["euphoric"],
    });
    const sVelvet = await song({
      title: "Velvet Hours", artistId: sage, kind: "single", stage: "writing",
      genre: "Soul", bpm: 76, musicalKey: "Bb", mode: "Major", moodTags: ["smoky", "slow"],
    });
    const sCircuit = await song({
      title: "Circuit Heart", artistId: aurora, kind: "single", stage: "released",
      genre: "Pop", bpm: 118, musicalKey: "G", mode: "Major",
      isrc: "USMYS2500098", streamCount: 88_400,
    });
    const sCostaNoche = await song({
      title: "Costa de Noche", artistId: tomas, kind: "single", stage: "mixing",
      genre: "Reggaeton", bpm: 96, musicalKey: "D", mode: "Minor", moodTags: ["sultry", "summer"],
    });
    const sHorizonline = await song({
      title: "Horizonline", artistId: pulsewave, kind: "spec", stage: "demo",
      genre: "EDM", bpm: 128, specStatus: "pitched", moodTags: ["festival", "sync-ready"],
    });
    await song({
      title: "Parade - Side A", artistId: crosstown, kind: "ep", stage: "mixing",
      genre: "Multi-genre", moodTags: ["compilation"],
    });
    const sGravity = await song({
      title: "Gravity Well", artistId: crosstown, kind: "album_track", stage: "tracking",
      genre: "Alt-Rock", bpm: 132, musicalKey: "F", mode: "Major",
    });
    const sIridescent = await song({
      title: "Iridescent", artistId: nova, kind: "album_track", stage: "demo",
      genre: "R&B", bpm: 88, musicalKey: "Eb", mode: "Major", moodTags: ["shimmering"],
    });
    const sStillframe = await song({
      title: "Stillframe", artistId: sage, kind: "spec", stage: "demo",
      genre: "Jazz", specStatus: "idea", moodTags: ["sparse", "sync-ready"],
    });

    // ── Sessions ──
    const session = async (cfg: {
      title: string;
      artistId: typeof nova;
      songId?: typeof sGoldenHour;
      serviceType:
        | "recording" | "mixing" | "mastering" | "production"
        | "consultation" | "rehearsal" | "writing";
      roomId?: typeof studioA;
      engineerId?: typeof theo;
      startOffsetDays: number;
      startHour: number;
      durationHours: number;
      status:
        | "tentative" | "confirmed" | "in_progress"
        | "completed" | "cancelled" | "no_show";
      rateCents: number;
      depositPaid: boolean;
      intakeCompleted: boolean;
    }) => {
      const base = new Date(now + cfg.startOffsetDays * DAY);
      base.setHours(cfg.startHour, 0, 0, 0);
      const startTime = base.getTime();
      return ctx.db.insert("sessions", {
        orgId,
        title: cfg.title,
        artistId: cfg.artistId,
        songId: cfg.songId,
        serviceType: cfg.serviceType,
        roomId: cfg.roomId,
        engineerId: cfg.engineerId,
        startTime,
        endTime: startTime + cfg.durationHours * HOUR,
        status: cfg.status,
        rateCents: cfg.rateCents,
        depositCents: Math.round(cfg.rateCents * 0.3),
        depositPaid: cfg.depositPaid,
        intakeCompleted: cfg.intakeCompleted,
      });
    };

    const sessGoldenTrack = await session({
      title: "Golden Hour - vocal comp", artistId: nova, songId: sGoldenHour,
      serviceType: "recording", roomId: studioA, engineerId: renzo,
      startOffsetDays: -6, startHour: 13, durationHours: 4,
      status: "completed", rateCents: 60000, depositPaid: true, intakeCompleted: true,
    });
    await session({
      title: "Paradise Static - drum tracking", artistId: midnight, songId: sParadise,
      serviceType: "recording", roomId: studioA, engineerId: theo,
      startOffsetDays: -3, startHour: 11, durationHours: 6,
      status: "completed", rateCents: 90000, depositPaid: true, intakeCompleted: true,
    });
    await session({
      title: "Carbon - master", artistId: kairo, songId: sCarbon,
      serviceType: "mastering", roomId: studioB, engineerId: sienna,
      startOffsetDays: -2, startHour: 15, durationHours: 2,
      status: "completed", rateCents: 28000, depositPaid: true, intakeCompleted: true,
    });
    await session({
      title: "Consultation - Bishop Grey", artistId: bishop,
      serviceType: "consultation", roomId: writeRoom, engineerId: jada,
      startOffsetDays: -1, startHour: 17, durationHours: 1,
      status: "no_show", rateCents: 0, depositPaid: false, intakeCompleted: false,
    });
    await session({
      title: "Golden Hour - mix revision", artistId: nova, songId: sGoldenHour,
      serviceType: "mixing", roomId: studioB, engineerId: sienna,
      startOffsetDays: 0, startHour: 14, durationHours: 3,
      status: "in_progress", rateCents: 45000, depositPaid: true, intakeCompleted: true,
    });
    await session({
      title: "Velvet Hours - writing session", artistId: sage, songId: sVelvet,
      serviceType: "writing", roomId: writeRoom, engineerId: theo,
      startOffsetDays: 1, startHour: 12, durationHours: 3,
      status: "confirmed", rateCents: 30000, depositPaid: true, intakeCompleted: true,
    });
    await session({
      title: "Costa de Noche - mix", artistId: tomas, songId: sCostaNoche,
      serviceType: "mixing", roomId: studioB, engineerId: sienna,
      startOffsetDays: 2, startHour: 13, durationHours: 4,
      status: "confirmed", rateCents: 48000, depositPaid: true, intakeCompleted: false,
    });
    await session({
      title: "Gravity Well - tracking", artistId: crosstown, songId: sGravity,
      serviceType: "recording", roomId: studioA, engineerId: theo,
      startOffsetDays: 3, startHour: 11, durationHours: 6,
      status: "confirmed", rateCents: 90000, depositPaid: true, intakeCompleted: true,
    });
    await session({
      title: "Iridescent - production", artistId: nova, songId: sIridescent,
      serviceType: "production", roomId: studioA, engineerId: renzo,
      startOffsetDays: 5, startHour: 14, durationHours: 5,
      status: "confirmed", rateCents: 75000, depositPaid: true, intakeCompleted: false,
    });
    await session({
      title: "Echo & the Drift - discovery call", artistId: echo,
      serviceType: "consultation", roomId: writeRoom, engineerId: jada,
      startOffsetDays: 6, startHour: 16, durationHours: 1,
      status: "tentative", rateCents: 0, depositPaid: false, intakeCompleted: false,
    });
    await session({
      title: "Halflight - vocal edits", artistId: midnight, songId: sHalflight,
      serviceType: "production", roomId: studioB, engineerId: renzo,
      startOffsetDays: 8, startHour: 13, durationHours: 3,
      status: "confirmed", rateCents: 45000, depositPaid: false, intakeCompleted: false,
    });
    await session({
      title: "Mira Quartz - first session", artistId: mira,
      serviceType: "recording", roomId: studioA, engineerId: theo,
      startOffsetDays: 9, startHour: 12, durationHours: 4,
      status: "tentative", rateCents: 60000, depositPaid: false, intakeCompleted: false,
    });

    // ── Engineering log (recall sheet) for the completed Golden Hour tracking ──
    await ctx.db.insert("engineeringLogs", {
      orgId,
      sessionId: sessGoldenTrack,
      songId: sGoldenHour,
      sampleRate: "48 kHz",
      bitDepth: "24-bit",
      tuningRef: "440 Hz",
      monitoring: "Focal Trio6 + NS-10",
      tempoMap: "92 BPM, straight",
      signalChains: [
        {
          track: "Lead Vocal",
          source: "Nova Reign",
          mic: "Telefunken U47",
          preamp: "Neve 1073",
          outboard: "1176 (4:1, fast)",
          input: "Console ch 12",
          micPosition: "8in, slight off-axis, pop filter",
        },
        {
          track: "Background Vox",
          source: "Nova Reign (stacked x4)",
          mic: "AKG C414",
          preamp: "API 512c",
          input: "Console ch 14",
        },
      ],
      notes: "Comp built from takes 3, 7, 9. Doubles tracked one octave stack. Keep the U47 patched for next session.",
      updatedAt: now - 6 * DAY,
    });

    // ── Deliverables ──
    const deliverable = async (cfg: {
      songId: typeof sGoldenHour;
      kind: "mix" | "master" | "stems" | "instrumental" | "reference" | "backup";
      version: number;
      label: string;
      status: "delivered" | "in_review" | "approved" | "final";
      durationSec?: number;
      paymentGated?: boolean;
      approved?: boolean;
    }) =>
      ctx.db.insert("deliverables", {
        orgId,
        songId: cfg.songId,
        kind: cfg.kind,
        version: cfg.version,
        label: cfg.label,
        status: cfg.status,
        durationSec: cfg.durationSec,
        paymentGated: cfg.paymentGated ?? false,
        approvedAt: cfg.approved ? now - 2 * DAY : undefined,
        approvedBy: cfg.approved ? "Nova Reign" : undefined,
      });

    const dGoldenV1 = await deliverable({
      songId: sGoldenHour, kind: "mix", version: 1, label: "Golden Hour - Mix v1",
      status: "in_review", durationSec: 211,
    });
    await deliverable({
      songId: sGoldenHour, kind: "reference", version: 1, label: "Rough reference",
      status: "delivered", durationSec: 208,
    });
    await deliverable({
      songId: sCarbon, kind: "master", version: 2, label: "Carbon - Master v2",
      status: "final", durationSec: 174, paymentGated: true, approved: true,
    });
    await deliverable({
      songId: sLowOrbit, kind: "stems", version: 1, label: "Low Orbit - Trackout",
      status: "approved", paymentGated: true, approved: true,
    });
    await deliverable({
      songId: sAfterglow, kind: "master", version: 1, label: "Afterglow - Master v1",
      status: "in_review", durationSec: 235,
    });

    // ── Revision comments on Golden Hour mix v1 ──
    await ctx.db.insert("revisionComments", {
      orgId, songId: sGoldenHour, deliverableId: dGoldenV1,
      timestampSec: 47, body: "Vocal sits a touch behind on the second verse - bring it up ~1dB.",
      authorName: "Nova Reign", resolved: false,
    });
    await ctx.db.insert("revisionComments", {
      orgId, songId: sGoldenHour, deliverableId: dGoldenV1,
      timestampSec: 92, body: "Love the bridge. The sub feels great here.",
      authorName: "Nova Reign", resolved: true,
    });
    await ctx.db.insert("revisionComments", {
      orgId, songId: sGoldenHour, deliverableId: dGoldenV1,
      timestampSec: 168, body: "Can we automate a little more air on the outro adlibs?",
      authorName: "Marcus Vale", resolved: false,
    });

    // ── Split sheets ──
    await ctx.db.insert("splitSheets", {
      orgId, songId: sGoldenHour, status: "sent", updatedAt: now - 3 * DAY,
      contributors: [
        { name: "Nova Reign", role: "Artist / Topline", masterPct: 50, publishingPct: 45,
          pro: "ASCAP", ipi: "00661124501", email: "nova@novareign.com", signed: true },
        { name: "Kairo", role: "Producer", masterPct: 40, publishingPct: 35,
          pro: "BMI", ipi: "00922100774", email: "kairo@kairobeats.com", signed: true },
        { name: "Lila Ferrari", role: "Co-writer", masterPct: 10, publishingPct: 20,
          pro: "ASCAP", email: "lila@lilaferrari.com", signed: false },
      ],
    });
    await ctx.db.insert("splitSheets", {
      orgId, songId: sNeonRain, status: "fully_executed", updatedAt: now - 40 * DAY,
      contributors: [
        { name: "Nova Reign", role: "Artist", masterPct: 60, publishingPct: 55, pro: "ASCAP", signed: true },
        { name: "Kairo", role: "Producer", masterPct: 40, publishingPct: 45, pro: "BMI", signed: true },
      ],
    });

    // ── Invoices ──
    const invoice = async (cfg: {
      number: string;
      artistId: typeof nova;
      songId?: typeof sGoldenHour;
      lineItems: { label: string; amountCents: number }[];
      status: "draft" | "sent" | "viewed" | "paid" | "overdue" | "void";
      dueOffsetDays: number;
      paidOffsetDays?: number;
    }) => {
      const amountCents = cfg.lineItems.reduce((s, li) => s + li.amountCents, 0);
      return ctx.db.insert("invoices", {
        orgId,
        number: cfg.number,
        artistId: cfg.artistId,
        songId: cfg.songId,
        status: cfg.status,
        lineItems: cfg.lineItems,
        amountCents,
        dueDate: now + cfg.dueOffsetDays * DAY,
        paidAt: cfg.paidOffsetDays !== undefined ? now + cfg.paidOffsetDays * DAY : undefined,
      });
    };

    await invoice({
      number: "PLS-100412", artistId: nova, songId: sNeonRain,
      lineItems: [{ label: "Neon Rain - full production", amountCents: 320000 }],
      status: "paid", dueOffsetDays: -34, paidOffsetDays: -38,
    });
    await invoice({
      number: "PLS-100455", artistId: kairo, songId: sCarbon,
      lineItems: [{ label: "Carbon - master", amountCents: 28000 }],
      status: "paid", dueOffsetDays: -8, paidOffsetDays: -5,
    });
    await invoice({
      number: "PLS-100461", artistId: nova, songId: sGoldenHour,
      lineItems: [
        { label: "Golden Hour - vocal session balance", amountCents: 42000 },
        { label: "Additional comp hour", amountCents: 12000 },
      ],
      status: "sent", dueOffsetDays: 9,
    });
    await invoice({
      number: "PLS-100468", artistId: midnight, songId: sParadise,
      lineItems: [{ label: "Paradise Static - drum tracking", amountCents: 63000 }],
      status: "viewed", dueOffsetDays: 4,
    });
    await invoice({
      number: "PLS-100390", artistId: aurora, songId: sCircuit,
      lineItems: [{ label: "Circuit Heart - mix + master", amountCents: 86000 }],
      status: "overdue", dueOffsetDays: -19,
    });
    await invoice({
      number: "PLS-100470", artistId: crosstown,
      lineItems: [{ label: "Studio A block booking - 20 hrs", amountCents: 300000 }],
      status: "draft", dueOffsetDays: 21,
    });
    await invoice({
      number: "PLS-100358", artistId: pulsewave, songId: sAfterglow,
      lineItems: [{ label: "Afterglow - production retainer", amountCents: 250000 }],
      status: "paid", dueOffsetDays: -52, paidOffsetDays: -49,
    });
    await invoice({
      number: "PLS-100472", artistId: tomas, songId: sCostaNoche,
      lineItems: [{ label: "Costa de Noche - mixing", amountCents: 48000 }],
      status: "sent", dueOffsetDays: 12,
    });

    // ── Opportunities (pipeline) ──
    const opp = async (cfg: {
      title: string;
      artistId: typeof nova;
      stage:
        | "inquiry" | "qualified" | "proposal" | "booked"
        | "in_progress" | "delivered" | "won" | "lost";
      valueCents: number;
      serviceType:
        | "recording" | "mixing" | "mastering" | "production"
        | "consultation" | "rehearsal" | "writing";
      probability: number;
      source?: string;
      songId?: typeof sGoldenHour;
      updatedOffsetDays: number;
    }) =>
      ctx.db.insert("opportunities", {
        orgId,
        title: cfg.title,
        artistId: cfg.artistId,
        stage: cfg.stage,
        valueCents: cfg.valueCents,
        serviceType: cfg.serviceType,
        probability: cfg.probability,
        source: cfg.source,
        songId: cfg.songId,
        updatedAt: now + cfg.updatedOffsetDays * DAY,
      });

    await opp({
      title: "Bishop Grey - debut EP", artistId: bishop, stage: "inquiry",
      valueCents: 480000, serviceType: "production", probability: 0.1,
      source: "Instagram DM", updatedOffsetDays: -1,
    });
    await opp({
      title: "Echo & the Drift - album", artistId: echo, stage: "qualified",
      valueCents: 1_200_000, serviceType: "recording", probability: 0.25,
      source: "Referral - Crosstown", updatedOffsetDays: -2,
    });
    await opp({
      title: "Mira Quartz - single package", artistId: mira, stage: "proposal",
      valueCents: 320000, serviceType: "recording", probability: 0.45,
      source: "Website form", updatedOffsetDays: -3,
    });
    await opp({
      title: "Gravity Well - tracking block", artistId: crosstown, stage: "booked",
      valueCents: 900000, serviceType: "recording", probability: 0.7,
      songId: sGravity, source: "Repeat client", updatedOffsetDays: -1,
    });
    await opp({
      title: "Costa de Noche - mix", artistId: tomas, stage: "in_progress",
      valueCents: 48000, serviceType: "mixing", probability: 0.85,
      songId: sCostaNoche, updatedOffsetDays: 0,
    });
    await opp({
      title: "Iridescent - production", artistId: nova, stage: "in_progress",
      valueCents: 750000, serviceType: "production", probability: 0.85,
      songId: sIridescent, source: "Repeat client", updatedOffsetDays: -1,
    });
    await opp({
      title: "Velvet Hours - full single", artistId: sage, stage: "delivered",
      valueCents: 210000, serviceType: "production", probability: 0.95,
      songId: sVelvet, updatedOffsetDays: -4,
    });
    await opp({
      title: "Afterglow - production retainer", artistId: pulsewave, stage: "won",
      valueCents: 250000, serviceType: "production", probability: 1,
      songId: sAfterglow, updatedOffsetDays: -49,
    });
    await opp({
      title: "Indie podcast theme", artistId: aurora, stage: "lost",
      valueCents: 60000, serviceType: "production", probability: 0,
      source: "Cold outreach", updatedOffsetDays: -30,
    });

    // ── Sync opportunities ──
    await ctx.db.insert("syncOpportunities", {
      orgId, songId: sFirstLight, supervisorName: "Dana Whitfield", outlet: "National ad - automotive",
      stage: "shortlisted", feeCents: 1_500_000, updatedAt: now - 5 * DAY,
    });
    await ctx.db.insert("syncOpportunities", {
      orgId, songId: sHorizonline, supervisorName: "Marco Reyes", outlet: "Streaming series - trailer",
      stage: "negotiating", feeCents: 850000, updatedAt: now - 2 * DAY,
    });
    await ctx.db.insert("syncOpportunities", {
      orgId, songId: sNeonRain, supervisorName: "Priya Anand", outlet: "Indie film - closing scene",
      stage: "placed", feeCents: 600000, updatedAt: now - 18 * DAY,
    });
    await ctx.db.insert("syncOpportunities", {
      orgId, songId: sStillframe, supervisorName: "Dana Whitfield", outlet: "Documentary - underscore",
      stage: "pitched", feeCents: 250000, updatedAt: now - 1 * DAY,
    });

    // ── Release campaigns ──
    const buildCampaign = async (
      songId: typeof sGoldenHour,
      releaseOffsetDays: number,
      status: "planning" | "active" | "released",
      doneCount: number,
    ) => {
      const releaseDate = now + releaseOffsetDays * DAY;
      const labels = [
        "Announce the release date", "Teaser clip #1", "Behind-the-scenes post",
        "Open pre-save / pre-order", "Email the fan list", "Teaser clip #2",
        "Cover-art reveal", "Release day - all platforms live", "Release-day SMS blast",
        "Thank-you + momentum post", "Playlist pitch follow-up", "First-week numbers recap",
      ];
      const offsets = [-14, -12, -9, -7, -6, -4, -2, 0, 0, 2, 5, 7];
      await ctx.db.insert("releaseCampaigns", {
        orgId,
        songId,
        releaseDate,
        status,
        tasks: labels.map((label, i) => ({ label, offsetDays: offsets[i], done: i < doneCount })),
      });
      await ctx.db.patch(songId, { releaseDate });
    };
    await buildCampaign(sGoldenHour, 24, "active", 5);
    await buildCampaign(sAfterglow, 11, "active", 7);
    await buildCampaign(sNeonRain, -40, "released", 12);

    // ── Beat licenses on Kairo's catalog ──
    await ctx.db.insert("licenses", {
      orgId, songId: sLowOrbit, buyerName: "Trell Above", tier: "wav",
      priceCents: 12900, termMonths: 12, streamCap: 500_000, active: true, soldAt: now - 21 * DAY,
    });
    await ctx.db.insert("licenses", {
      orgId, songId: sLowOrbit, buyerName: "Saint Cairo", tier: "mp3",
      priceCents: 4900, termMonths: 6, streamCap: 100_000, active: true, soldAt: now - 9 * DAY,
    });
    await ctx.db.insert("licenses", {
      orgId, songId: sCarbon, buyerName: "Bishop Grey", tier: "exclusive",
      priceCents: 90000, active: true, soldAt: now - 4 * DAY,
    });

    // ── Activity feed ──
    const act = async (
      kind: string,
      summary: string,
      offsetHours: number,
      accent?: string,
      entityType?: string,
      entityId?: string,
    ) => {
      const id = await ctx.db.insert("activity", { orgId, kind, summary, accent, entityType, entityId });
      // Backdate creation so the feed reads chronologically.
      void offsetHours;
      return id;
    };
    await act("invoice.paid", "PLS-100455 paid in full by Kairo", -2, "positive", "artist", kairo);
    await act("session.completed", "Carbon - master completed", -5, "positive", "song", sCarbon);
    await act("session.no_show", "No-show flagged - Bishop Grey marked for review", -20, "critical", "artist", bishop);
    await act("session.in_progress", "Golden Hour - mix revision underway in Studio B", -1, "info", "song", sGoldenHour);
    await act("opportunity.created", "New inquiry - Echo & the Drift album", -36, "gold", "artist", echo);
    await act("license.sold", "EXCLUSIVE license sold - Carbon to Bishop Grey", -96, "positive", "song", sCarbon);
    await act("sync.placed", "Sync placed - Neon Rain with Priya Anand", -432, "positive", "song", sNeonRain);
    await act("song.stage", "Afterglow moved to mastering", -60, "info", "song", sAfterglow);

    // ── AI insights ──
    await ctx.db.insert("insights", {
      orgId, kind: "risk", severity: "warning",
      title: "Aurora Sky has gone quiet",
      body: "No session in 124 days and an invoice 19 days overdue. Send a re-engagement note and a gentle payment reminder.",
      entityType: "artist", entityId: aurora, status: "new",
    });
    await ctx.db.insert("insights", {
      orgId, kind: "revenue", severity: "opportunity",
      title: "Golden Hour is on revision 2 of 4",
      body: "Two open mix notes from Nova Reign. Resolve them before the count creeps toward the included cap.",
      entityType: "song", entityId: sGoldenHour, status: "new",
    });
    await ctx.db.insert("insights", {
      orgId, kind: "opportunity", severity: "opportunity",
      title: "First Light is shortlisted for a national ad",
      body: "Dana Whitfield shortlisted the topline at a $15k fee. Confirm the split sheet is clean before you negotiate.",
      entityType: "song", entityId: sFirstLight, status: "new",
    });
    await ctx.db.insert("insights", {
      orgId, kind: "recap", severity: "info",
      title: "Recap ready - Paradise Static drum tracking",
      body: "Log the recall sheet while the room is still set, then invoice the remaining balance.",
      entityType: "song", entityId: sParadise, status: "seen",
    });

    return { ok: true, org: "Lumen Recording Co.", seededAt: now };
  },
});
