/* ============================================================
   Software catalog - curated reference data for the "Add
   software" dropdown. Selecting an item prefills name, vendor,
   category, license type, and a typical price (USD). Users edit
   freely and can add custom software not listed here.

   Prices are APPROXIMATE (USD) compiled mid-2026 for prefill;
   subscriptions note the typical recurring price + interval.
   Categories mirror softwareLicenses.category in the schema.
   ============================================================ */

export type SoftwareCategory =
  | "daw"
  | "plugin"
  | "sample_library"
  | "subscription"
  | "utility"
  | "other";

export type SoftwareLicenseType = "perpetual" | "subscription";
export type BillingInterval = "one_time" | "monthly" | "annual";

export type SoftwareCatalogItem = {
  id: string;
  name: string;
  vendor: string;
  category: SoftwareCategory;
  licenseType: SoftwareLicenseType;
  billingInterval: BillingInterval;
  priceCents: number;
  note?: string;
};

const D = (d: number) => Math.round(d * 100);

export const SOFTWARE_CATALOG: SoftwareCatalogItem[] = [
  // ── DAWs ─────────────────────────────────────────────────
  { id: "pro-tools-studio", name: "Pro Tools Studio", vendor: "Avid", category: "daw", licenseType: "subscription", billingInterval: "annual", priceCents: D(299), note: "Annual subscription" },
  { id: "pro-tools-perpetual", name: "Pro Tools (Perpetual)", vendor: "Avid", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(599) },
  { id: "logic-pro", name: "Logic Pro", vendor: "Apple", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(199) },
  { id: "ableton-live-suite", name: "Ableton Live 12 Suite", vendor: "Ableton", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(599) },
  { id: "ableton-live-standard", name: "Ableton Live 12 Standard", vendor: "Ableton", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(439) },
  { id: "fl-studio-producer", name: "FL Studio Producer Edition", vendor: "Image-Line", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(199) },
  { id: "fl-studio-signature", name: "FL Studio Signature", vendor: "Image-Line", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(299) },
  { id: "reason", name: "Reason", vendor: "Reason Studios", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(199) },
  { id: "cubase-pro", name: "Cubase Pro", vendor: "Steinberg", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(579) },
  { id: "studio-one-pro", name: "Studio One Pro", vendor: "PreSonus", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(399) },
  { id: "bitwig-studio", name: "Bitwig Studio", vendor: "Bitwig", category: "daw", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(399) },

  // ── Plugins / bundles ────────────────────────────────────
  { id: "fabfilter-bundle", name: "FabFilter Total Bundle", vendor: "FabFilter", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(999), note: "All FabFilter plugins" },
  { id: "fabfilter-proq", name: "FabFilter Pro-Q 4", vendor: "FabFilter", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(199) },
  { id: "fabfilter-pro-c", name: "FabFilter Pro-C 2", vendor: "FabFilter", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(179) },
  { id: "waves-platinum", name: "Waves Platinum", vendor: "Waves", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(119), note: "Bundle (subscription/WUP optional)" },
  { id: "waves-mercury", name: "Waves Mercury", vendor: "Waves", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(999) },
  { id: "slate-all-access", name: "Slate Digital All Access Pass", vendor: "Slate Digital", category: "plugin", licenseType: "subscription", billingInterval: "annual", priceCents: D(199), note: "All Slate plugins" },
  { id: "izotope-ozone", name: "iZotope Ozone Advanced", vendor: "iZotope", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(499) },
  { id: "izotope-rx", name: "iZotope RX Standard", vendor: "iZotope", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(399) },
  { id: "soundtoys-5", name: "Soundtoys 5 Bundle", vendor: "Soundtoys", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(499) },
  { id: "autotune-pro", name: "Auto-Tune Pro X", vendor: "Antares", category: "plugin", licenseType: "subscription", billingInterval: "annual", priceCents: D(199) },
  { id: "melodyne-studio", name: "Melodyne 5 Studio", vendor: "Celemony", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(699) },
  { id: "serato-sample", name: "Serato Sample", vendor: "Serato", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(149) },
  { id: "uad-spark", name: "UAD Spark", vendor: "Universal Audio", category: "plugin", licenseType: "subscription", billingInterval: "annual", priceCents: D(149) },
  { id: "arturia-vcollection", name: "Arturia V Collection", vendor: "Arturia", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(599) },
  { id: "arturia-analog-lab", name: "Arturia Analog Lab", vendor: "Arturia", category: "plugin", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(99) },

  // ── Sample libraries / instruments ───────────────────────
  { id: "ni-komplete-ultimate", name: "Komplete 15 Ultimate", vendor: "Native Instruments", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(1199) },
  { id: "ni-komplete-standard", name: "Komplete 15 Standard", vendor: "Native Instruments", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(599) },
  { id: "ni-battery-4", name: "Battery 4", vendor: "Native Instruments", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(199), note: "Drum sampler" },
  { id: "ni-kontakt", name: "Kontakt 8", vendor: "Native Instruments", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(399) },
  { id: "spectrasonics-omnisphere", name: "Omnisphere 2", vendor: "Spectrasonics", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(499) },
  { id: "spectrasonics-keyscape", name: "Keyscape", vendor: "Spectrasonics", category: "sample_library", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(399) },
  { id: "output-arcade", name: "Output Arcade", vendor: "Output", category: "subscription", licenseType: "subscription", billingInterval: "monthly", priceCents: D(10) },

  // ── Subscriptions / services ─────────────────────────────
  { id: "splice", name: "Splice", vendor: "Splice", category: "subscription", licenseType: "subscription", billingInterval: "monthly", priceCents: D(13), note: "Sample subscription" },
  { id: "loopcloud", name: "Loopcloud", vendor: "Loopcloud", category: "subscription", licenseType: "subscription", billingInterval: "monthly", priceCents: D(8) },
  { id: "soundcloud-next", name: "SoundCloud Next Pro", vendor: "SoundCloud", category: "subscription", licenseType: "subscription", billingInterval: "annual", priceCents: D(120) },
  { id: "distrokid", name: "DistroKid", vendor: "DistroKid", category: "subscription", licenseType: "subscription", billingInterval: "annual", priceCents: D(23), note: "Distribution" },
  { id: "adobe-cc", name: "Adobe Creative Cloud", vendor: "Adobe", category: "subscription", licenseType: "subscription", billingInterval: "monthly", priceCents: D(60) },
  { id: "dropbox-pro", name: "Dropbox Professional", vendor: "Dropbox", category: "subscription", licenseType: "subscription", billingInterval: "annual", priceCents: D(200) },

  // ── Utilities ────────────────────────────────────────────
  { id: "ilok-cloud", name: "iLok License Manager", vendor: "PACE", category: "utility", licenseType: "perpetual", billingInterval: "one_time", priceCents: D(0), note: "Free license manager" },
  { id: "microsoft-365", name: "Microsoft 365", vendor: "Microsoft", category: "subscription", licenseType: "subscription", billingInterval: "annual", priceCents: D(100) },
];

function hay(it: SoftwareCatalogItem): string {
  return `${it.vendor} ${it.name} ${it.note ?? ""}`.toLowerCase();
}

/** Search the software catalog by free text, optionally filtered by category.
 *  Pure - safe to call from a Convex query or a test. */
export function searchSoftwareCatalog(
  query: string,
  category?: string,
  limit = 20,
): SoftwareCatalogItem[] {
  const pool = category
    ? SOFTWARE_CATALOG.filter((it) => it.category === category)
    : SOFTWARE_CATALOG;
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...pool]
      .sort((a, b) => `${a.vendor} ${a.name}`.localeCompare(`${b.vendor} ${b.name}`))
      .slice(0, limit);
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = pool
    .map((it) => {
      const h = hay(it);
      if (!terms.every((t) => h.includes(t))) return null;
      const label = `${it.vendor} ${it.name}`.toLowerCase();
      let score = 0;
      if (label.startsWith(q)) score += 100;
      if (it.name.toLowerCase().startsWith(terms[0])) score += 40;
      if (label.includes(q)) score += 20;
      score += terms.length;
      return { it, score };
    })
    .filter((x): x is { it: SoftwareCatalogItem; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name));
  return scored.slice(0, limit).map((x) => x.it);
}
