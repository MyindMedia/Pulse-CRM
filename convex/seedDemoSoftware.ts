import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/* ============================================================
   Demo software-fill. Loads a realistic, robust set of studio
   software into softwareLicenses for a demo org (default: Myind
   Sound) so the Software & Licenses module looks lived-in for
   pitching: DAWs, plugins, sample libraries, subscriptions and
   utilities with sensible costs, billing intervals, seats and
   renewal dates. Idempotent - every row it creates is tagged
   (notes ends with the TAG marker) and wiped before a re-fill,
   so real data is untouched.
   ============================================================ */

const TAG = "[demo_software]";
const DAY = 86_400_000;

type Category = "daw" | "plugin" | "sample_library" | "subscription" | "utility" | "other";
type LicenseType = "perpetual" | "subscription";
type Interval = "one_time" | "monthly" | "annual";
type Status = "active" | "expired" | "unused";

type Item = {
  name: string;
  vendor: string;
  category: Category;
  licenseType: LicenseType;
  billingInterval: Interval;
  costCents: number; // for subscriptions this is the per-interval price; for perpetual the one-time price
  seats?: number;
  seatHolder?: string;
  status?: Status; // default active
  note?: string; // human note (TAG appended automatically)
  // renewal offset in days from "now" for subscriptions (positive = future)
  renewalInDays?: number;
  // purchase offset in days before "now" (positive = days ago)
  purchasedDaysAgo?: number;
};

const CATALOG: Item[] = [
  // ── DAWs ──────────────────────────────────────────────
  { name: "Pro Tools Studio", vendor: "Avid", category: "daw", licenseType: "subscription", billingInterval: "annual", costCents: 29900, seats: 2, seatHolder: "Main + Mix room", renewalInDays: 120, purchasedDaysAgo: 245, note: "Annual subscription, flagship tracking DAW" },
  { name: "Logic Pro", vendor: "Apple", category: "daw", licenseType: "perpetual", billingInterval: "one_time", costCents: 19999, seats: 3, seatHolder: "Studio Macs", purchasedDaysAgo: 540, note: "Perpetual, used for production + scoring" },
  { name: "Ableton Live 12 Suite", vendor: "Ableton", category: "daw", licenseType: "perpetual", billingInterval: "one_time", costCents: 74900, seats: 2, seatHolder: "Producers", purchasedDaysAgo: 410, note: "Suite edition, electronic + beat production" },
  { name: "FL Studio Producer Edition", vendor: "Image-Line", category: "daw", licenseType: "perpetual", billingInterval: "one_time", costCents: 19900, seats: 1, seatHolder: "Beat room", purchasedDaysAgo: 700, note: "Lifetime free updates" },
  { name: "Studio One 7 Professional", vendor: "PreSonus", category: "daw", licenseType: "perpetual", billingInterval: "one_time", costCents: 39999, seats: 1, status: "unused", purchasedDaysAgo: 320, note: "Backup DAW, occasional mastering" },

  // ── Plugins ───────────────────────────────────────────
  { name: "FabFilter Pro-Q 4", vendor: "FabFilter", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 17900, seats: 3, seatHolder: "All rooms", purchasedDaysAgo: 180, note: "Reference EQ" },
  { name: "FabFilter Pro-C 2", vendor: "FabFilter", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 17900, seats: 3, purchasedDaysAgo: 180, note: "Compressor" },
  { name: "FabFilter Pro-L 2", vendor: "FabFilter", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 16900, seats: 2, purchasedDaysAgo: 180, note: "Mastering limiter" },
  { name: "Waves Mercury Bundle", vendor: "Waves Audio", category: "plugin", licenseType: "subscription", billingInterval: "annual", costCents: 24900, seats: 2, seatHolder: "Mix engineers", renewalInDays: 64, purchasedDaysAgo: 300, note: "WUP coverage on flagship bundle" },
  { name: "UAD Spark", vendor: "Universal Audio", category: "plugin", licenseType: "subscription", billingInterval: "monthly", costCents: 1999, seats: 2, renewalInDays: 18, purchasedDaysAgo: 210, note: "Native UAD emulations" },
  { name: "iZotope Ozone 11 Advanced", vendor: "iZotope", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 49900, seats: 1, seatHolder: "Mastering", purchasedDaysAgo: 150, note: "Mastering suite" },
  { name: "iZotope RX 11 Advanced", vendor: "iZotope", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 99900, seats: 1, seatHolder: "Post / repair", purchasedDaysAgo: 150, note: "Audio repair + dialogue cleanup" },
  { name: "Soundtoys 5", vendor: "Soundtoys", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 49900, seats: 2, purchasedDaysAgo: 260, note: "Creative effects rack" },
  { name: "Slate Digital All Access Pass", vendor: "Slate Digital", category: "plugin", licenseType: "subscription", billingInterval: "annual", costCents: 14900, seats: 2, renewalInDays: 95, purchasedDaysAgo: 270, note: "Full Slate plugin catalog" },
  { name: "Antares Auto-Tune Unlimited", vendor: "Antares", category: "plugin", licenseType: "subscription", billingInterval: "monthly", costCents: 2499, seats: 2, seatHolder: "Vocal rooms", renewalInDays: 9, purchasedDaysAgo: 130, note: "Pitch correction, vocal production" },
  { name: "Serum 2", vendor: "Xfer Records", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 18900, seats: 2, seatHolder: "Producers", purchasedDaysAgo: 360, note: "Wavetable synth" },
  { name: "Omnisphere 2", vendor: "Spectrasonics", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 49900, seats: 1, purchasedDaysAgo: 620, note: "Flagship synth + sound library" },
  { name: "Valhalla Bundle (VintageVerb / Delay)", vendor: "Valhalla DSP", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", costCents: 10000, seats: 3, purchasedDaysAgo: 480, note: "Reverbs + delays" },

  // ── Sample libraries ──────────────────────────────────
  { name: "Native Instruments Komplete 15 Ultimate", vendor: "Native Instruments", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", costCents: 119900, seats: 2, seatHolder: "Production rigs", purchasedDaysAgo: 220, note: "Kontakt + flagship instrument collection" },
  { name: "Spitfire BBC Symphony Orchestra Pro", vendor: "Spitfire Audio", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", costCents: 89900, seats: 1, seatHolder: "Scoring", purchasedDaysAgo: 290, note: "Orchestral scoring library" },
  { name: "Output Arcade", vendor: "Output", category: "sample_library", licenseType: "subscription", billingInterval: "monthly", costCents: 1000, seats: 2, renewalInDays: 22, purchasedDaysAgo: 140, note: "Loop + sample playground" },
  { name: "Superior Drummer 3", vendor: "Toontrack", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", costCents: 39900, seats: 1, seatHolder: "Drum room", purchasedDaysAgo: 500, note: "Sampled acoustic drums" },

  // ── Subscriptions / services ──────────────────────────
  { name: "Splice Creator", vendor: "Splice", category: "subscription", licenseType: "subscription", billingInterval: "monthly", costCents: 1299, seats: 3, seatHolder: "Whole team", renewalInDays: 12, purchasedDaysAgo: 400, note: "Royalty-free sample subscription" },
  { name: "Adobe Creative Cloud (All Apps)", vendor: "Adobe", category: "subscription", licenseType: "subscription", billingInterval: "monthly", costCents: 5999, seats: 2, seatHolder: "Content + visuals", renewalInDays: 27, purchasedDaysAgo: 365, note: "Audition, Premiere, Photoshop for content" },
  { name: "iLok Cloud + Backup", vendor: "PACE", category: "subscription", licenseType: "subscription", billingInterval: "annual", costCents: 2999, seats: 1, renewalInDays: 200, purchasedDaysAgo: 160, note: "License management + activation backup" },
  { name: "Dropbox Business", vendor: "Dropbox", category: "subscription", licenseType: "subscription", billingInterval: "annual", costCents: 24000, seats: 3, seatHolder: "Session delivery", renewalInDays: 48, purchasedDaysAgo: 320, note: "Client session + stem delivery storage" },
  { name: "LANDR Mastering Studio", vendor: "LANDR", category: "subscription", licenseType: "subscription", billingInterval: "annual", costCents: 11988, seats: 1, status: "unused", renewalInDays: 35, purchasedDaysAgo: 330, note: "AI mastering for quick references" },
  { name: "DistroKid", vendor: "DistroKid", category: "subscription", licenseType: "subscription", billingInterval: "annual", costCents: 2299, seats: 1, seatHolder: "Releases", renewalInDays: 150, purchasedDaysAgo: 215, note: "Distribution for in-house releases" },

  // ── Utilities ─────────────────────────────────────────
  { name: "Sonarworks SoundID Reference", vendor: "Sonarworks", category: "utility", licenseType: "perpetual", billingInterval: "one_time", costCents: 9900, seats: 3, seatHolder: "All rooms", purchasedDaysAgo: 240, note: "Monitor + headphone calibration" },
  { name: "Metric AB", vendor: "ADPTR Audio", category: "utility", licenseType: "perpetual", billingInterval: "one_time", costCents: 9900, seats: 2, purchasedDaysAgo: 200, note: "Reference-track loudness matching" },
  { name: "Audio Hijack", vendor: "Rogue Amoeba", category: "utility", licenseType: "perpetual", billingInterval: "one_time", costCents: 6900, seats: 2, purchasedDaysAgo: 300, note: "System audio capture for sessions" },
  { name: "Antidote AntiVirus (expired)", vendor: "Malwarebytes", category: "utility", licenseType: "subscription", billingInterval: "annual", costCents: 3999, seats: 3, status: "expired", renewalInDays: -20, purchasedDaysAgo: 400, note: "Endpoint protection, needs renewal" },
];

export const fillSoftware = internalMutation({
  args: {
    orgId: v.string(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();

    // ── Wipe prior demo software (idempotent re-fill) ──
    const old = await ctx.db
      .query("softwareLicenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let removed = 0;
    for (const row of old) {
      if (row.notes && row.notes.includes(TAG)) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }

    let added = 0;
    for (const item of CATALOG) {
      const purchaseDate =
        item.purchasedDaysAgo != null ? now - item.purchasedDaysAgo * DAY : undefined;
      const renewalDate =
        item.licenseType === "subscription" && item.renewalInDays != null
          ? now + item.renewalInDays * DAY
          : undefined;
      const note = item.note ? `${item.note} ${TAG}` : TAG;

      await ctx.db.insert("softwareLicenses", {
        orgId,
        name: item.name,
        vendor: item.vendor,
        category: item.category,
        licenseType: item.licenseType,
        seats: item.seats,
        costCents: item.costCents,
        billingInterval: item.billingInterval,
        purchaseDate,
        renewalDate,
        seatHolder: item.seatHolder,
        status: item.status ?? "active",
        notes: note,
        createdAt: now,
      });
      added++;
    }

    return { orgId, removed, added, total: CATALOG.length };
  },
});
