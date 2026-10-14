import { internalMutation } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================
   Demo "rich clients" fill. Makes the sales-demo studio look lived in:
   packages, memberships, bookable services, fee templates, waitlist,
   reviews, visitors, payments, booking-page traffic.

   CALL ORDER (each is its own mutation so every call stays well under
   the 1 second limit; each is idempotent on its own):
     1. fill         catalog + clients  (~60 writes)
     2. fillPeople   reviews, visitors, payments, sms contacts (~75 writes)
     3. fillTraffic  bookingVisits (~45 writes)
   Args for all: { orgId, nowMs? }. Run 1 before 2 if you want reviews
   and payments linked to the same sessions (2 reads sessions only).

   TAG PER TABLE (only tagged rows are deleted on a re-run; rows I did
   not create are never touched):
     packageProducts   name in PRODUCTS list below (unique names)
     packageCredits    stripeReference starts "demo_rich_"
     membershipPlans   name in PLANS list below (unique names)
     memberships       stripeSubscriptionId starts "demo_rich_"
     bookableServices  name in SERVICES list below (unique names)
     feeTemplates      label in FEES list below (unique labels)
     waitlistEntries   note in WAITLIST list below (unique notes)
     reviews           source === "demo_rich"
     visitors          email in the VISITORS list below (unique @example.com)
     payments          reference starts "demo_rich_"
     smsContacts       phone in SMS_PHONES below (fake 555-01xx numbers)
     bookingVisits     visitorKey starts "demo_rich_"

   SEND SAFETY: nothing here writes notifications, messages, outbox or
   proposed-action rows, and no waitlist/payment/visitor insert fires a
   send path (the waitlist offer is sent by a mutation on session cancel,
   not by a row insert). No payment is left "pending". No Stripe objects
   are created; stripe-ish ids are inert "demo_rich_" strings.
   ============================================================ */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TAG = "demo_rich";

type DbCtx = { db: any };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const money = (cents: number) => Math.round(cents);

/* ── Catalog definitions ─────────────────────────────────── */

const PRODUCTS = [
  { name: "Starter Block, 5 Hours", hours: 5, priceCents: 40000, description: "Five prepaid studio hours. Use them on any room, any engineer, any week." },
  { name: "Session Pack, 10 Hours", hours: 10, priceCents: 72000, description: "Ten hours at 10% off the walk-in rate. Our most popular block." },
  { name: "Album Block, 25 Hours", hours: 25, priceCents: 160000, description: "Twenty-five hours for a full project, recording through mix. 20% off." },
  { name: "Mix Bundle, 4 Mixes", hours: 12, priceCents: 78000, description: "Four song mixes with two revisions each. Twelve engineer hours." },
  { name: "Writing Camp, 8 Hours", hours: 8, priceCents: 49600, description: "A day in the writing room with a producer on hand." },
] as const;

const PLANS = [
  { name: "Studio Regular", description: "Four bundled hours a month and priority booking.", priceCents: 29900, bundledHoursPerPeriod: 4, memberDiscountPct: 10, priorityBooking: true },
  { name: "Producer Pro", description: "Ten bundled hours a month, 15% off extra time, first pick of prime slots.", priceCents: 64900, bundledHoursPerPeriod: 10, memberDiscountPct: 15, priorityBooking: true },
  { name: "Label Elite", description: "Twenty-five hours a month for working teams, 20% off overtime.", priceCents: 139900, bundledHoursPerPeriod: 25, memberDiscountPct: 20, priorityBooking: true },
] as const;

const FEES = [
  { label: "Late Cancellation Fee", amountCents: 7500, description: "Charged when a session is cancelled inside 24 hours." },
  { label: "No-Show Fee", amountCents: 15000, description: "Charged when the client does not arrive and the slot goes unused." },
  { label: "Overtime, Per Half Hour", amountCents: 4000, description: "Billed when a session runs past the booked end time." },
  { label: "Rush Mix Turnaround", amountCents: 12500, description: "Mix delivered in 48 hours instead of five days." },
  { label: "Session Files Archive", amountCents: 2500, description: "Full session files zipped and stored for 12 months." },
  { label: "Stem Export, Per Song", amountCents: 3500, description: "Labeled stems delivered for a single song." },
] as const;

type SvcType = "recording" | "mixing" | "mastering" | "production" | "writing" | "rehearsal" | "consultation" | "custom";
const SERVICES: {
  name: string; blurb: string; mode: "hourly" | "flat"; priceCents: number;
  minHours?: number; blockHours?: number; type: SvcType; roomPref: string; fees: number[];
}[] = [
  { name: "Vocal Recording", blurb: "Treated booth, a staff engineer and a clean signal chain.", mode: "hourly", priceCents: 8000, minHours: 2, type: "recording", roomPref: "live", fees: [2, 4, 5] },
  { name: "Full Band Tracking", blurb: "Live room with drums, amps and isolation for a whole band.", mode: "hourly", priceCents: 12500, minHours: 4, type: "recording", roomPref: "live", fees: [2, 4, 5] },
  { name: "Mixing Session", blurb: "Bring your stems. Mix in the suite with an engineer.", mode: "hourly", priceCents: 6500, minHours: 2, type: "mixing", roomPref: "mix", fees: [3, 4, 5] },
  { name: "Mastering, Per Song", blurb: "Final polish, loudness and delivery formats for one song.", mode: "flat", priceCents: 9500, blockHours: 1, type: "mastering", roomPref: "mix", fees: [4] },
  { name: "Production Day", blurb: "Eight hours with a producer building the record from scratch.", mode: "flat", priceCents: 72000, blockHours: 8, type: "production", roomPref: "prod", fees: [2, 4, 5] },
  { name: "Songwriting Session", blurb: "A writing room, a keyboard and a co-writer.", mode: "hourly", priceCents: 5500, minHours: 3, type: "writing", roomPref: "writ", fees: [5] },
  { name: "Podcast Recording", blurb: "Four mics, a host-friendly room and a clean edit.", mode: "flat", priceCents: 24000, blockHours: 2, type: "custom", roomPref: "pod", fees: [4, 5] },
];

const WAITLIST: { note: string; priority: "standard" | "high"; status: "waiting" | "notified" | "booked" | "removed"; svc: SvcType; startDays: number; spanDays: number }[] = [
  { note: "Wants a Saturday night vocal session as soon as one opens.", priority: "high", status: "waiting", svc: "recording", startDays: 2, spanDays: 6 },
  { note: "Flexible on room. Any mix suite slot after 6pm.", priority: "standard", status: "waiting", svc: "mixing", startDays: 3, spanDays: 10 },
  { note: "Needs two days in a row for a full band tracking weekend.", priority: "high", status: "waiting", svc: "recording", startDays: 9, spanDays: 7 },
  { note: "Looking for a morning writing room slot next week.", priority: "standard", status: "waiting", svc: "writing", startDays: 5, spanDays: 7 },
  { note: "Wants first pick on any cancelled production day.", priority: "standard", status: "waiting", svc: "production", startDays: 4, spanDays: 12 },
  { note: "Offered the Thursday 2pm opening, waiting on a reply.", priority: "high", status: "notified", svc: "recording", startDays: 1, spanDays: 3 },
  { note: "Offered a mix suite slot Friday afternoon.", priority: "standard", status: "notified", svc: "mixing", startDays: 2, spanDays: 4 },
  { note: "Took the cancelled Tuesday slot and booked it.", priority: "standard", status: "booked", svc: "mastering", startDays: 6, spanDays: 3 },
  { note: "No longer needs the slot, removed at their request.", priority: "standard", status: "removed", svc: "rehearsal", startDays: 7, spanDays: 5 },
];

/* ── Helpers ─────────────────────────────────────────────── */

async function orgBasics(ctx: DbCtx, orgId: string) {
  const rooms: Doc<"rooms">[] = await ctx.db.query("rooms").withIndex("by_org", (q: any) => q.eq("orgId", orgId)).collect();
  const artists: Doc<"artists">[] = await ctx.db.query("artists").withIndex("by_org", (q: any) => q.eq("orgId", orgId)).collect();
  const members: Doc<"members">[] = await ctx.db.query("members").withIndex("by_org", (q: any) => q.eq("orgId", orgId)).collect();
  return { rooms, artists, members };
}

async function pastSessions(ctx: DbCtx, orgId: string, now: number, days: number) {
  const rows: Doc<"sessions">[] = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q: any) => q.eq("orgId", orgId).gte("startTime", now - days * DAY).lte("startTime", now))
    .collect();
  return rows.filter((s) => s.status === "completed").sort((a, b) => b.startTime - a.startTime);
}

/* ── 1. Catalog + client holdings ────────────────────────── */

export const fill = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();
    const { rooms, artists } = await orgBasics(ctx, orgId);
    if (rooms.length === 0 || artists.length === 0) {
      return { error: "Org has no rooms or artists. Seed the studio first." };
    }
    const r = rng(now / DAY);

    // ── Wipe my previous rows (tagged tables first, children before parents). ──
    const credits = await ctx.db.query("packageCredits").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const c of credits) if (c.stripeReference?.startsWith("demo_rich_")) await ctx.db.delete(c._id);
    const mems = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const m of mems) if (m.stripeSubscriptionId?.startsWith("demo_rich_")) await ctx.db.delete(m._id);
    const prods = await ctx.db.query("packageProducts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const prodNames = new Set<string>(PRODUCTS.map((p) => p.name));
    for (const p of prods) if (prodNames.has(p.name)) await ctx.db.delete(p._id);
    const plans = await ctx.db.query("membershipPlans").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const planNames = new Set<string>(PLANS.map((p) => p.name));
    for (const p of plans) if (planNames.has(p.name)) await ctx.db.delete(p._id);
    const svcs = await ctx.db.query("bookableServices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const svcNames = new Set<string>(SERVICES.map((s) => s.name));
    for (const s of svcs) if (svcNames.has(s.name)) await ctx.db.delete(s._id);
    const feesOld = await ctx.db.query("feeTemplates").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const feeLabels = new Set<string>(FEES.map((f) => f.label));
    for (const f of feesOld) if (feeLabels.has(f.label)) await ctx.db.delete(f._id);
    const waits = await ctx.db.query("waitlistEntries").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const waitNotes = new Set<string>(WAITLIST.map((w) => w.note));
    for (const w of waits) if (w.note && waitNotes.has(w.note)) await ctx.db.delete(w._id);

    // ── Fee templates ──
    const feeIds: Id<"feeTemplates">[] = [];
    for (let i = 0; i < FEES.length; i++) {
      const f = FEES[i];
      feeIds.push(await ctx.db.insert("feeTemplates", { orgId, ...f, active: true, createdAt: now - (30 + i) * DAY }));
    }

    // ── Bookable services (matched to a room by type keyword, else round robin) ──
    const roomFor = (pref: string, i: number) =>
      rooms.find((rm) => `${rm.roomType ?? ""} ${rm.name}`.toLowerCase().includes(pref)) ?? rooms[i % rooms.length];
    const baseOrder = svcs.reduce((m, s) => Math.max(m, s.order), 0);
    for (let i = 0; i < SERVICES.length; i++) {
      const s = SERVICES[i];
      await ctx.db.insert("bookableServices", {
        orgId,
        name: s.name,
        blurb: s.blurb,
        pricingMode: s.mode,
        priceCents: s.priceCents,
        minimumHours: s.mode === "hourly" ? s.minHours : undefined,
        blockHours: s.mode === "flat" ? s.blockHours : undefined,
        depositPct: 25,
        roomId: roomFor(s.roomPref, i)._id,
        sessionServiceType: s.type,
        addOnFeeIds: s.fees.map((ix) => feeIds[ix]),
        order: baseOrder + 1 + i,
        active: true,
        createdAt: now - (45 - i) * DAY,
      });
    }

    // ── Package products ──
    const prodIds: Id<"packageProducts">[] = [];
    for (const p of PRODUCTS) prodIds.push(await ctx.db.insert("packageProducts", { orgId, ...p, active: true }));

    // ── Credits held by artists, partial usage ──
    const shuffled = [...artists].sort(() => r() - 0.5);
    const holders = shuffled.slice(0, Math.min(8, shuffled.length));
    // [product index, fraction remaining, status, days ago]
    const CREDIT_PLAN: [number, number, "active" | "depleted" | "expired", number][] = [
      [1, 0.6, "active", 21], [0, 0.2, "active", 34], [2, 0.84, "active", 9], [3, 0.5, "active", 16],
      [1, 0, "depleted", 78], [4, 0.75, "active", 6], [2, 0.36, "active", 42], [0, 1, "active", 2],
      [1, 0.9, "active", 4], [0, 0.4, "expired", 140],
    ];
    for (let i = 0; i < CREDIT_PLAN.length; i++) {
      const [pi, frac, status, ago] = CREDIT_PLAN[i];
      const p = PRODUCTS[pi];
      const a = holders[i % holders.length];
      await ctx.db.insert("packageCredits", {
        orgId,
        artistId: a._id,
        productId: prodIds[pi],
        name: p.name,
        hoursTotal: p.hours,
        hoursRemaining: status === "depleted" || status === "expired" ? (status === "expired" ? Math.round(p.hours * frac) : 0) : Math.round(p.hours * frac * 2) / 2,
        priceCents: p.priceCents,
        status,
        purchasedAt: now - ago * DAY,
        stripeReference: `demo_rich_pkg_${i + 1}`,
      });
    }

    // ── Membership plans + memberships ──
    const planIds: Id<"membershipPlans">[] = [];
    for (let i = 0; i < PLANS.length; i++) {
      planIds.push(await ctx.db.insert("membershipPlans", {
        orgId, ...PLANS[i], billingInterval: "month", active: true, createdAt: now - (120 - i * 20) * DAY,
      }));
    }
    // [plan index, status, hours used, day within current period, member since days]
    const MEM_PLAN: [number, "active" | "past_due" | "cancelled" | "trialing", number, number, number][] = [
      [1, "active", 6, 12, 190], [0, "active", 3, 12, 140], [2, "active", 17, 12, 95],
      [1, "active", 8.5, 12, 70], [0, "active", 1, 12, 52], [0, "trialing", 0.5, 4, 4],
      [1, "past_due", 4, 12, 160], [0, "cancelled", 0, 12, 110], [2, "active", 21, 12, 210],
      [0, "cancelled", 0, 12, 88], [1, "active", 2, 12, 30], [0, "active", 3, 12, 25],
    ];
    const memArtists = [...artists].sort(() => r() - 0.5);
    for (let i = 0; i < MEM_PLAN.length; i++) {
      const [pi, status, used, dayIn, since] = MEM_PLAN[i];
      const start = now - dayIn * DAY;
      const cancelled = status === "cancelled";
      await ctx.db.insert("memberships", {
        orgId,
        artistId: memArtists[i % memArtists.length]._id,
        planId: planIds[pi],
        status,
        currentPeriodStart: cancelled ? now - 40 * DAY : start,
        currentPeriodEnd: cancelled ? now - 10 * DAY : start + 30 * DAY,
        hoursUsedThisPeriod: used,
        stripeSubscriptionId: `demo_rich_sub_${i + 1}`,
        createdAt: now - since * DAY,
      });
    }

    // ── Waitlist ──
    const rest = [...artists].sort(() => r() - 0.5);
    for (let i = 0; i < WAITLIST.length; i++) {
      const w = WAITLIST[i];
      const from = now + w.startDays * DAY;
      await ctx.db.insert("waitlistEntries", {
        orgId,
        artistId: rest[i % rest.length]._id,
        roomId: i % 3 === 2 ? undefined : rooms[i % rooms.length]._id,
        serviceType: w.svc,
        note: w.note,
        priority: w.priority,
        status: w.status,
        preferredFrom: from,
        preferredTo: from + w.spanDays * DAY,
        lastNotifiedAt: w.status === "notified" || w.status === "booked" ? now - (i % 3 + 1) * 5 * HOUR : undefined,
        createdAt: now - (2 + i * 2) * DAY,
      });
    }

    return { ok: true, tag: TAG, services: SERVICES.length, products: PRODUCTS.length, credits: CREDIT_PLAN.length, memberships: MEM_PLAN.length, waitlist: WAITLIST.length };
  },
});

/* ── 2. Reviews, visitors, payments, sms contacts ────────── */

const REVIEWS: { rating: number; text: string; name?: string; hidden?: boolean; ago: number }[] = [
  { rating: 5, text: "Best sounding vocal booth I have used in LA. The engineer got my take in two passes and the room felt calm the whole night.", ago: 3 },
  { rating: 5, text: "Booked online at midnight, showed up the next afternoon and everything was ready. Gear was exactly as listed.", name: "Marcus Bell", ago: 6 },
  { rating: 5, text: "Our mix came back warm and wide. Two small notes, both handled the same day.", ago: 9 },
  { rating: 4, text: "Great room and great people. Parking is tight, so arrive early. The sound made up for it.", name: "Danielle Ortiz", ago: 12 },
  { rating: 5, text: "Tracked a full band in one day. Drums sounded huge and nobody had to wait on a setup.", ago: 15 },
  { rating: 5, text: "Mastering was fast and the loudness hit the target on every platform. Will send the next EP here.", name: "Jordan Whitfield", ago: 18 },
  { rating: 5, text: "The writing room has a real vibe. We came out with two finished songs and a hook we are still humming.", ago: 21 },
  { rating: 4, text: "Clean, professional, and on time. I wish the lounge had more outlets, but that is my only note.", name: "Priya Raman", ago: 25 },
  { rating: 5, text: "Everything about the booking was easy. Deposit, reminders, a text when the room was ready.", ago: 28 },
  { rating: 5, text: "I have recorded in bigger studios that sounded smaller. This room just works.", name: "Tomas Herrera", ago: 33 },
  { rating: 4, text: "Engineer knew exactly what I wanted from a one line reference. Slight wait at check in, then smooth.", ago: 38 },
  { rating: 5, text: "Production day was worth every dollar. We left with a finished beat and stems the same night.", ago: 44 },
  { rating: 5, text: "Mix revisions were quick and the notes I got back were useful, not generic.", name: "Alicia Brandt", ago: 52 },
  { rating: 5, text: "My podcast sounds like a real show now. Four mics, zero bleed, and they cleaned the edit overnight.", name: "Devon Clarke", ago: 61 },
  { rating: 4, text: "Solid session and a fair price. Would book the bigger room next time.", ago: 70 },
  { rating: 3, text: "Good sound but we ran a bit over and the overtime surprised us. Support sorted it out.", name: "Ryan Patel", hidden: true, ago: 80 },
];

type VisitorDef = { name: string; email: string; phone: string; purpose: string; src: "qr" | "front_desk"; ago: number; mins: number; open?: boolean; artist?: boolean };
const VISITORS: VisitorDef[] = [
  { name: "Nadia Okafor", email: "nadia.okafor@example.com", phone: "+15550142001", purpose: "Vocal session", src: "qr", ago: 0.08, mins: 0, open: true, artist: true },
  { name: "Elliot Marsh", email: "elliot.marsh@example.com", phone: "+15550142002", purpose: "Mix review with engineer", src: "front_desk", ago: 0.15, mins: 0, open: true },
  { name: "Camille Duval", email: "camille.duval@example.com", phone: "+15550142003", purpose: "Studio tour", src: "front_desk", ago: 0.9, mins: 40 },
  { name: "Isaiah Greene", email: "isaiah.greene@example.com", phone: "+15550142004", purpose: "Tracking session", src: "qr", ago: 1.1, mins: 185, artist: true },
  { name: "Mei Tanaka", email: "mei.tanaka@example.com", phone: "+15550142005", purpose: "Mastering pickup", src: "front_desk", ago: 1.8, mins: 25 },
  { name: "Gabriel Santos", email: "gabriel.santos@example.com", phone: "+15550142006", purpose: "Songwriting session", src: "qr", ago: 2.2, mins: 210, artist: true },
  { name: "Harper Lindqvist", email: "harper.lindqvist@example.com", phone: "+15550142007", purpose: "Label meeting", src: "front_desk", ago: 3.1, mins: 75 },
  { name: "Tariq Hussain", email: "tariq.hussain@example.com", phone: "+15550142008", purpose: "Podcast recording", src: "qr", ago: 3.9, mins: 130 },
  { name: "Olivia Brandt", email: "olivia.brandt@example.com", phone: "+15550142009", purpose: "Photo and video shoot", src: "front_desk", ago: 4.5, mins: 150 },
  { name: "Wesley Cho", email: "wesley.cho@example.com", phone: "+15550142010", purpose: "Gear drop-off", src: "front_desk", ago: 5.2, mins: 15 },
  { name: "Simone Achebe", email: "simone.achebe@example.com", phone: "+15550142011", purpose: "Vocal session", src: "qr", ago: 6.0, mins: 170, artist: true },
  { name: "Luca Moretti", email: "luca.moretti@example.com", phone: "+15550142012", purpose: "Guest session player", src: "qr", ago: 7.3, mins: 120 },
  { name: "Ayesha Rahman", email: "ayesha.rahman@example.com", phone: "+15550142013", purpose: "Mix revisions", src: "qr", ago: 8.1, mins: 95, artist: true },
  { name: "Derek Fontaine", email: "derek.fontaine@example.com", phone: "+15550142014", purpose: "Equipment repair visit", src: "front_desk", ago: 9.4, mins: 60 },
  { name: "Renee Calloway", email: "renee.calloway@example.com", phone: "+15550142015", purpose: "Songwriting session", src: "qr", ago: 11, mins: 200 },
  { name: "Mateo Alvarez", email: "mateo.alvarez@example.com", phone: "+15550142016", purpose: "Production day", src: "qr", ago: 12.6, mins: 420, artist: true },
  { name: "Sofia Petrova", email: "sofia.petrova@example.com", phone: "+15550142017", purpose: "Studio tour", src: "front_desk", ago: 14.2, mins: 35 },
  { name: "Kwame Boateng", email: "kwame.boateng@example.com", phone: "+15550142018", purpose: "Rehearsal", src: "qr", ago: 16.0, mins: 180 },
  { name: "Brooke Sullivan", email: "brooke.sullivan@example.com", phone: "+15550142019", purpose: "Management check-in", src: "front_desk", ago: 18.3, mins: 50 },
  { name: "Andre Lawson", email: "andre.lawson@example.com", phone: "+15550142020", purpose: "Vocal session", src: "qr", ago: 20.1, mins: 160, artist: true },
  { name: "Imani Brooks", email: "imani.brooks@example.com", phone: "+15550142021", purpose: "Music video shoot", src: "front_desk", ago: 22.7, mins: 240 },
  { name: "Felix Nguyen", email: "felix.nguyen@example.com", phone: "+15550142022", purpose: "Mastering session", src: "qr", ago: 24.4, mins: 70 },
  { name: "Talia Weiss", email: "talia.weiss@example.com", phone: "+15550142023", purpose: "Podcast recording", src: "qr", ago: 26.0, mins: 125 },
  { name: "Omar Haddad", email: "omar.haddad@example.com", phone: "+15550142024", purpose: "Tracking session", src: "qr", ago: 27.9, mins: 230, artist: true },
  { name: "Juliet Okonkwo", email: "juliet.okonkwo@example.com", phone: "+15550142025", purpose: "Vocal session", src: "qr", ago: 29.2, mins: 150 },
];
const SMS_PHONES = ["+15550142001", "+15550142004", "+15550142011", "+15550142016", "+15550142020"];

export const fillPeople = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();
    const { artists, members } = await orgBasics(ctx, orgId);
    if (artists.length === 0) return { error: "Org has no artists. Seed the studio first." };

    // ── Wipe my previous rows. ──
    const revs = await ctx.db.query("reviews").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const x of revs) if (x.source === TAG) await ctx.db.delete(x._id);
    const visEmails = new Set<string>(VISITORS.map((x) => x.email));
    const vis = await ctx.db.query("visitors").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const x of vis) if (visEmails.has(x.email)) await ctx.db.delete(x._id);
    const pays = await ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const x of pays) if (x.reference?.startsWith("demo_rich_")) await ctx.db.delete(x._id);
    const smsOld = await ctx.db.query("smsContacts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const smsSet = new Set<string>(SMS_PHONES);
    for (const x of smsOld) if (smsSet.has(x.phone)) await ctx.db.delete(x._id);

    const done = await pastSessions(ctx, orgId, now, 60);
    const used = new Set<string>();
    const nextSession = (artistId?: Id<"artists">) => {
      const hit = done.find((s) => !used.has(s._id) && (!artistId || s.artistId === artistId)) ?? done.find((s) => !used.has(s._id));
      if (hit) used.add(hit._id);
      return hit;
    };
    const artistById = new Map(artists.map((a) => [a._id, a]));

    // ── Reviews ──
    for (let i = 0; i < REVIEWS.length; i++) {
      const rv = REVIEWS[i];
      const s = nextSession();
      const a = s ? artistById.get(s.artistId) : artists[i % artists.length];
      await ctx.db.insert("reviews", {
        orgId,
        artistId: a?._id,
        sessionId: s?._id,
        rating: rv.rating,
        text: rv.text,
        authorName: rv.name ?? a?.name,
        status: rv.hidden ? "hidden" : "published",
        source: TAG,
        at: now - rv.ago * DAY,
      });
    }

    // ── Visitors ──
    const hosts = members.length ? members : [];
    for (let i = 0; i < VISITORS.length; i++) {
      const x = VISITORS[i];
      const checkInAt = now - x.ago * DAY;
      const a = x.artist ? artists[i % artists.length] : undefined;
      const s = x.artist && x.ago > 0.5 ? nextSession(a?._id) : undefined;
      await ctx.db.insert("visitors", {
        orgId,
        name: x.name,
        email: x.email,
        phone: x.phone,
        purpose: x.purpose,
        hostName: hosts.length ? hosts[i % hosts.length].name : undefined,
        artistId: a?._id,
        sessionId: s?._id,
        sessionMatchedBy: s ? "email" : undefined,
        termsAcceptedAt: x.src === "qr" ? checkInAt : undefined,
        checkInAt,
        checkOutAt: x.open ? undefined : checkInAt + x.mins * 60_000,
        source: x.src,
      });
    }

    // ── Payments across methods and kinds, on recent completed sessions ──
    const KINDS: ("deposit" | "balance" | "full")[] = ["deposit", "balance", "full"];
    const payPool = done.slice(0, 40);
    let pn = 0;
    for (let i = 0; i < 20 && i < payPool.length; i++) {
      const s = payPool[i];
      const a = artistById.get(s.artistId);
      const hrs = Math.max(1, (s.endTime - s.startTime) / HOUR);
      const total = money(s.rateCents * hrs);
      const kind = KINDS[i % 3];
      const amount = kind === "deposit" ? (s.depositCents > 0 ? s.depositCents : money(total * 0.25)) : kind === "balance" ? money(total * 0.75) : total;
      const status: "paid" | "refunded" | "failed" = i === 7 ? "refunded" : i === 13 ? "failed" : "paid";
      await ctx.db.insert("payments", {
        orgId,
        sessionId: s._id,
        kind,
        amountCents: amount,
        provider: i % 4 === 3 ? "simulated" : "stripe",
        status,
        reference: `demo_rich_pay_${++pn}`,
        payerName: a?.name,
        paidAt: status === "failed" ? undefined : Math.min(now - HOUR, s.startTime + (kind === "deposit" ? -2 * DAY : HOUR)),
      });
    }

    // ── SMS contacts (rate-limit/routing records only, nothing is sent) ──
    for (let i = 0; i < SMS_PHONES.length; i++) {
      await ctx.db.insert("smsContacts", { phone: SMS_PHONES[i], orgId, lastSentAt: now - (i + 1) * 3 * DAY });
    }

    return { ok: true, tag: TAG, reviews: REVIEWS.length, visitors: VISITORS.length, payments: pn, sms: SMS_PHONES.length, completedSessionsFound: done.length };
  },
});

/* ── 3. Booking-page traffic ─────────────────────────────── */

export const fillTraffic = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();
    const { rooms } = await orgBasics(ctx, orgId);

    const old = await ctx.db.query("bookingVisits").withIndex("by_org_day", (q) => q.eq("orgId", orgId)).collect();
    for (const x of old) if (x.visitorKey.startsWith("demo_rich_")) await ctx.db.delete(x._id);

    const done = await pastSessions(ctx, orgId, now, 30);
    const r = rng(Math.floor(now / DAY) + 7);
    const REFS: (string | undefined)[] = [undefined, undefined, "instagram", "google", "friend"];
    let n = 0;
    let bookedIx = 0;
    // 18 visitors: all land; 14 open a room; 8 reach checkout; up to 5 book.
    for (let i = 0; i < 18; i++) {
      const at = now - Math.floor(r() * 29 * DAY) - HOUR;
      const key = `demo_rich_v${i}`;
      const src = REFS[i % REFS.length];
      const utm = i % 3 === 0 ? "instagram" : i % 3 === 1 ? "google" : undefined;
      const room = rooms.length ? rooms[i % rooms.length]._id : undefined;
      const base = { orgId, visitorKey: key, day: dayKey(at), ref: src, utmSource: utm };
      await ctx.db.insert("bookingVisits", { ...base, step: "page", createdAt: at });
      n++;
      if (i < 14) { await ctx.db.insert("bookingVisits", { ...base, step: "room", roomId: room, createdAt: at + 60_000 }); n++; }
      if (i < 8) { await ctx.db.insert("bookingVisits", { ...base, step: "checkout", roomId: room, createdAt: at + 4 * 60_000 }); n++; }
      if (i < 5) {
        const s = done[bookedIx++];
        await ctx.db.insert("bookingVisits", {
          ...base,
          step: "booked",
          roomId: s?.roomId ?? room,
          sessionId: s?._id,
          amountCents: s ? Math.round(s.rateCents * Math.max(1, (s.endTime - s.startTime) / HOUR)) : 24000 + i * 6000,
          createdAt: at + 7 * 60_000,
        });
        n++;
      }
    }
    return { ok: true, tag: TAG, bookingVisits: n };
  },
});
