/* ============================================================
   Studio gear catalog - curated reference data for the
   "Add equipment" dropdown. Selecting an item prefills name,
   category, and a typical NEW street price (USD); users edit
   freely and can always add custom gear not listed here.

   Prices are APPROXIMATE street prices (USD) compiled mid-2026
   for prefill only - they are not live quotes. `priceCents` is
   integer cents. `imageUrl` is optional and only set where a
   stable image is known (populated progressively).

   Categories mirror the equipment category union in
   convex/equipment.ts + convex/schema.ts.
   ============================================================ */

export type GearCategory =
  | "console"
  | "mic"
  | "preamp"
  | "interface"
  | "outboard"
  | "monitor"
  | "headphones"
  | "synth"
  | "midi"
  | "instrument"
  | "monitor_controller"
  | "other";

export type GearCatalogItem = {
  /** Stable slug id. */
  id: string;
  brand: string;
  model: string;
  category: GearCategory;
  /** Typical NEW street price in USD cents (approximate, for prefill). */
  priceCents: number;
  /** Optional manufacturer model number / SKU. */
  modelNumber?: string;
  /** Short spec / description. */
  note?: string;
  /** Stable product image URL, when known. */
  imageUrl?: string;
  /** Required attribution for the image (CC sources). Shown wherever the image
   *  is displayed. */
  imageCredit?: string;
};

/* Image credits (Wikimedia Commons) - shown in the catalog picker:
   - Shure SM57: E bailey, CC BY-SA 4.0
   - Teletronix LA-2A: Wikimedia Commons, CC BY 4.0
   - UA 1176: John Tuggle, CC BY 2.0
   - Minimoog: Krash, public domain
   - Fender Jazz Bass: BrianReading, CC BY-SA 4.0
   - Korg Minilogue: Aeternus, CC BY-SA 4.0
   - Gibson Les Paul: Lightburst, CC BY-SA 4.0 */

const D = (dollars: number): number => Math.round(dollars * 100);

export const GEAR_CATALOG: GearCatalogItem[] = [
  // ── Audio interfaces ─────────────────────────────────────
  { id: "focusrite-scarlett-solo-4g", brand: "Focusrite", model: "Scarlett Solo (4th Gen)", category: "interface", priceCents: D(139), note: "2-in/2-out USB-C interface" },
  { id: "focusrite-scarlett-2i2-4g", brand: "Focusrite", model: "Scarlett 2i2 (4th Gen)", category: "interface", priceCents: D(199), note: "2-in/2-out USB-C, Auto Gain" },
  { id: "focusrite-scarlett-4i4-4g", brand: "Focusrite", model: "Scarlett 4i4 (4th Gen)", category: "interface", priceCents: D(279) },
  { id: "focusrite-scarlett-8i6-4g", brand: "Focusrite", model: "Scarlett 8i6 (4th Gen)", category: "interface", priceCents: D(349) },
  { id: "focusrite-scarlett-18i8-4g", brand: "Focusrite", model: "Scarlett 18i8 (4th Gen)", category: "interface", priceCents: D(499) },
  { id: "focusrite-scarlett-18i20-4g", brand: "Focusrite", model: "Scarlett 18i20 (4th Gen)", category: "interface", priceCents: D(699), note: "Rackmount 18-in/20-out" },
  { id: "focusrite-clarett-4pre", brand: "Focusrite", model: "Clarett+ 4Pre", category: "interface", priceCents: D(599) },
  { id: "focusrite-clarett-8pre", brand: "Focusrite", model: "Clarett+ 8Pre", category: "interface", priceCents: D(899) },
  { id: "ua-apollo-twin-x-duo", brand: "Universal Audio", model: "Apollo Twin X DUO (Heritage)", category: "interface", priceCents: D(899), note: "Thunderbolt, 2 Unison preamps" },
  { id: "ua-apollo-twin-x-quad", brand: "Universal Audio", model: "Apollo Twin X QUAD", category: "interface", priceCents: D(1299) },
  { id: "ua-apollo-x4", brand: "Universal Audio", model: "Apollo x4", category: "interface", priceCents: D(1499) },
  { id: "ua-apollo-x6", brand: "Universal Audio", model: "Apollo x6", category: "interface", priceCents: D(2099) },
  { id: "ua-apollo-x8", brand: "Universal Audio", model: "Apollo x8", category: "interface", priceCents: D(2699) },
  { id: "ua-apollo-x8p", brand: "Universal Audio", model: "Apollo x8p", category: "interface", priceCents: D(2999), note: "8 Unison preamps" },
  { id: "ua-apollo-x16", brand: "Universal Audio", model: "Apollo x16", category: "interface", priceCents: D(3499) },
  { id: "ua-volt-2", brand: "Universal Audio", model: "Volt 2", category: "interface", priceCents: D(189) },
  { id: "ua-volt-276", brand: "Universal Audio", model: "Volt 276", category: "interface", priceCents: D(299), note: "2-ch with built-in compressor" },
  { id: "ua-volt-476", brand: "Universal Audio", model: "Volt 476", category: "interface", priceCents: D(399) },
  { id: "motu-m2", brand: "MOTU", model: "M2", category: "interface", priceCents: D(199) },
  { id: "motu-m4", brand: "MOTU", model: "M4", category: "interface", priceCents: D(269) },
  { id: "motu-828", brand: "MOTU", model: "828 (USB)", category: "interface", priceCents: D(1095) },
  { id: "motu-ultralite-mk5", brand: "MOTU", model: "UltraLite mk5", category: "interface", priceCents: D(699) },
  { id: "rme-babyface-pro-fs", brand: "RME", model: "Babyface Pro FS", category: "interface", priceCents: D(899) },
  { id: "rme-fireface-ucx-ii", brand: "RME", model: "Fireface UCX II", category: "interface", priceCents: D(1599) },
  { id: "rme-fireface-ufx-iii", brand: "RME", model: "Fireface UFX III", category: "interface", priceCents: D(2999) },
  { id: "ssl-2-mkii", brand: "Solid State Logic", model: "SSL 2 MkII", category: "interface", priceCents: D(229) },
  { id: "ssl-2plus-mkii", brand: "Solid State Logic", model: "SSL 2+ MkII", category: "interface", priceCents: D(279) },
  { id: "ssl-12", brand: "Solid State Logic", model: "SSL 12", category: "interface", priceCents: D(649) },
  { id: "audient-id4-mkii", brand: "Audient", model: "iD4 MkII", category: "interface", priceCents: D(199) },
  { id: "audient-id14-mkii", brand: "Audient", model: "iD14 MkII", category: "interface", priceCents: D(299) },
  { id: "audient-id44-mkii", brand: "Audient", model: "iD44 MkII", category: "interface", priceCents: D(599) },
  { id: "audient-evo-4", brand: "Audient", model: "EVO 4", category: "interface", priceCents: D(129) },
  { id: "apogee-symphony-desktop", brand: "Apogee", model: "Symphony Desktop", category: "interface", priceCents: D(1495) },
  { id: "apogee-duet-3", brand: "Apogee", model: "Duet 3", category: "interface", priceCents: D(595) },
  { id: "presonus-quantum-hd2", brand: "PreSonus", model: "Quantum HD2", category: "interface", priceCents: D(399) },

  // ── Microphones ──────────────────────────────────────────
  { id: "neumann-u87-ai", brand: "Neumann", model: "U 87 Ai", category: "mic", priceCents: D(3200), note: "Large-diaphragm condenser, 3 patterns" },
  { id: "neumann-u67", brand: "Neumann", model: "U 67 (reissue)", category: "mic", priceCents: D(7295), note: "Tube condenser" },
  { id: "neumann-tlm103", brand: "Neumann", model: "TLM 103", category: "mic", priceCents: D(1199) },
  { id: "neumann-tlm102", brand: "Neumann", model: "TLM 102", category: "mic", priceCents: D(749) },
  { id: "neumann-tlm49", brand: "Neumann", model: "TLM 49", category: "mic", priceCents: D(1799) },
  { id: "neumann-km184", brand: "Neumann", model: "KM 184 (pair)", category: "mic", priceCents: D(1700), note: "Small-diaphragm cardioid" },
  { id: "akg-c414-xlii", brand: "AKG", model: "C414 XLII", category: "mic", priceCents: D(1199), note: "9 polar patterns" },
  { id: "akg-c414-xls", brand: "AKG", model: "C414 XLS", category: "mic", priceCents: D(1099) },
  { id: "akg-c214", brand: "AKG", model: "C214", category: "mic", priceCents: D(479) },
  { id: "shure-sm7b", brand: "Shure", model: "SM7B", category: "mic", priceCents: D(399), note: "Dynamic vocal/broadcast" },
  { id: "shure-sm7db", brand: "Shure", model: "SM7dB", category: "mic", priceCents: D(499), note: "SM7B with active preamp" },
  { id: "shure-sm57", brand: "Shure", model: "SM57", category: "mic", priceCents: D(99), note: "Dynamic instrument", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Shure_SM57_microphone.jpg/960px-Shure_SM57_microphone.jpg", imageCredit: "E bailey / Wikimedia Commons, CC BY-SA 4.0" },
  { id: "shure-sm58", brand: "Shure", model: "SM58", category: "mic", priceCents: D(99), note: "Dynamic vocal" },
  { id: "shure-ksm44a", brand: "Shure", model: "KSM44A", category: "mic", priceCents: D(999) },
  { id: "shure-beta52a", brand: "Shure", model: "Beta 52A", category: "mic", priceCents: D(189), note: "Kick drum dynamic" },
  { id: "sennheiser-md421-ii", brand: "Sennheiser", model: "MD 421-II", category: "mic", priceCents: D(399), note: "Dynamic, toms/guitar" },
  { id: "sennheiser-md441-u", brand: "Sennheiser", model: "MD 441-U", category: "mic", priceCents: D(999) },
  { id: "sennheiser-e906", brand: "Sennheiser", model: "e 906", category: "mic", priceCents: D(189), note: "Guitar cab dynamic" },
  { id: "sennheiser-mkh416", brand: "Sennheiser", model: "MKH 416", category: "mic", priceCents: D(999), note: "Shotgun" },
  { id: "rode-nt1-5g", brand: "Rode", model: "NT1 (5th Gen)", category: "mic", priceCents: D(259) },
  { id: "rode-nt1a", brand: "Rode", model: "NT1-A", category: "mic", priceCents: D(229) },
  { id: "rode-nt2a", brand: "Rode", model: "NT2-A", category: "mic", priceCents: D(399) },
  { id: "rode-nt5-pair", brand: "Rode", model: "NT5 (matched pair)", category: "mic", priceCents: D(429) },
  { id: "rode-podmic", brand: "Rode", model: "PodMic", category: "mic", priceCents: D(99) },
  { id: "rode-broadcaster", brand: "Rode", model: "Broadcaster", category: "mic", priceCents: D(419) },
  { id: "at-at2020", brand: "Audio-Technica", model: "AT2020", category: "mic", priceCents: D(99) },
  { id: "at-at4040", brand: "Audio-Technica", model: "AT4040", category: "mic", priceCents: D(299) },
  { id: "at-at4050", brand: "Audio-Technica", model: "AT4050", category: "mic", priceCents: D(699), note: "Multi-pattern condenser" },
  { id: "warm-wa87-r2", brand: "Warm Audio", model: "WA-87 R2", category: "mic", priceCents: D(599), note: "U87-style FET condenser" },
  { id: "warm-wa47", brand: "Warm Audio", model: "WA-47", category: "mic", priceCents: D(899), note: "U47-style tube condenser" },
  { id: "warm-wa251", brand: "Warm Audio", model: "WA-251", category: "mic", priceCents: D(799) },
  { id: "royer-r121", brand: "Royer", model: "R-121", category: "mic", priceCents: D(1495), note: "Ribbon, guitar cabs" },
  { id: "aea-r84", brand: "AEA", model: "R84", category: "mic", priceCents: D(1099), note: "Ribbon" },
  { id: "coles-4038", brand: "Coles", model: "4038", category: "mic", priceCents: D(1499), note: "Ribbon, drum overheads" },
  { id: "ev-re20", brand: "Electro-Voice", model: "RE20", category: "mic", priceCents: D(549), note: "Dynamic broadcast/kick/VO" },
  { id: "mojave-ma200", brand: "Mojave", model: "MA-200", category: "mic", priceCents: D(1095), note: "Tube condenser" },
  { id: "lewitt-lct440-pure", brand: "Lewitt", model: "LCT 440 PURE", category: "mic", priceCents: D(299) },
  { id: "se-se2200", brand: "sE Electronics", model: "sE2200", category: "mic", priceCents: D(299) },

  // ── Preamps ──────────────────────────────────────────────
  { id: "ua-610-solo", brand: "Universal Audio", model: "SOLO/610", category: "preamp", priceCents: D(899), note: "Single-channel tube preamp/DI" },
  { id: "neve-1073dpx", brand: "AMS Neve", model: "1073DPX", category: "preamp", priceCents: D(4795), note: "Dual 1073 preamp + EQ" },
  { id: "neve-1073spx", brand: "AMS Neve", model: "1073SPX", category: "preamp", priceCents: D(2495) },
  { id: "api-512c", brand: "API", model: "512c", category: "preamp", priceCents: D(845), note: "500-series mic pre" },
  { id: "api-3124v", brand: "API", model: "3124V", category: "preamp", priceCents: D(2995), note: "4-channel preamp" },
  { id: "focusrite-isa-one", brand: "Focusrite", model: "ISA One", category: "preamp", priceCents: D(599) },
  { id: "focusrite-isa428-mk2", brand: "Focusrite", model: "ISA428 MkII", category: "preamp", priceCents: D(1499), note: "4-channel preamp" },
  { id: "grace-m101", brand: "Grace Design", model: "m101", category: "preamp", priceCents: D(795) },
  { id: "warm-wa73", brand: "Warm Audio", model: "WA73", category: "preamp", priceCents: D(699), note: "1073-style preamp" },
  { id: "warm-wa12-mkii", brand: "Warm Audio", model: "WA12 MkII", category: "preamp", priceCents: D(349) },
  { id: "ssl-alpha-channel", brand: "Solid State Logic", model: "Alpha Channel", category: "preamp", priceCents: D(699), note: "Preamp + EQ + dynamics" },
  { id: "chandler-tg2", brand: "Chandler Limited", model: "TG2", category: "preamp", priceCents: D(2799) },

  // ── Outboard (compressors / EQ / dynamics) ───────────────
  { id: "ua-1176ln", brand: "Universal Audio", model: "1176LN", category: "outboard", priceCents: D(1499), note: "FET compressor/limiter", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/UA_LA1176_Rev.A_%28Universal_Audio_Limiting_Amplifier%29_angled_-_1093_Studios%2C_Athens%2C_Georgia_%282010-06-21_03.14.39_by_John_Tuggle%29.jpg/960px-UA_LA1176_Rev.A_%28Universal_Audio_Limiting_Amplifier%29_angled_-_1093_Studios%2C_Athens%2C_Georgia_%282010-06-21_03.14.39_by_John_Tuggle%29.jpg", imageCredit: "John Tuggle / Wikimedia Commons, CC BY 2.0" },
  { id: "ua-la2a", brand: "Universal Audio", model: "Teletronix LA-2A", category: "outboard", priceCents: D(1799), note: "Optical tube leveling amp", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Teletronix_LA-2A_Leveling_Amplifier_-_PatchWerk_Recording_Studios%2C_2007_%28edit_%26_clip%29.jpg/960px-Teletronix_LA-2A_Leveling_Amplifier_-_PatchWerk_Recording_Studios%2C_2007_%28edit_%26_clip%29.jpg", imageCredit: "Wikimedia Commons, CC BY 4.0" },
  { id: "ua-la610-mkii", brand: "Universal Audio", model: "LA-610 MkII", category: "outboard", priceCents: D(1499), note: "Channel strip (610 pre + T4 comp)" },
  { id: "ua-6176", brand: "Universal Audio", model: "6176", category: "outboard", priceCents: D(2799), note: "610 preamp + 1176 compressor" },
  { id: "empirical-distressor", brand: "Empirical Labs", model: "Distressor EL8", category: "outboard", priceCents: D(1499), note: "Knee compressor" },
  { id: "ssl-g-bus-comp", brand: "Solid State Logic", model: "G-Series Bus Compressor", category: "outboard", priceCents: D(2199), note: "The mix-bus 'glue' comp" },
  { id: "ssl-fusion", brand: "Solid State Logic", model: "Fusion", category: "outboard", priceCents: D(1999), note: "Analogue master-bus processor" },
  { id: "tubetech-cl1b", brand: "Tube-Tech", model: "CL 1B", category: "outboard", priceCents: D(3295), note: "Opto vocal compressor" },
  { id: "warm-wa2a", brand: "Warm Audio", model: "WA-2A", category: "outboard", priceCents: D(699), note: "LA-2A-style opto comp" },
  { id: "warm-wa76", brand: "Warm Audio", model: "WA76", category: "outboard", priceCents: D(699), note: "1176-style FET comp" },
  { id: "warm-buscomp", brand: "Warm Audio", model: "Bus-Comp", category: "outboard", priceCents: D(799), note: "Bus compressor" },
  { id: "api-2500", brand: "API", model: "2500", category: "outboard", priceCents: D(3295), note: "Stereo bus compressor" },
  { id: "dbx-160a", brand: "dbx", model: "160A", category: "outboard", priceCents: D(399), note: "VCA compressor/limiter" },
  { id: "warm-eqp-wa", brand: "Warm Audio", model: "EQP-WA", category: "outboard", priceCents: D(799), note: "Pultec EQP-1A-style tube EQ" },
  { id: "api-550b", brand: "API", model: "550B", category: "outboard", priceCents: D(845), note: "4-band 500-series EQ" },
  { id: "api-560", brand: "API", model: "560", category: "outboard", priceCents: D(725), note: "10-band graphic EQ" },
  { id: "maag-eq4", brand: "Maag Audio", model: "EQ4", category: "outboard", priceCents: D(900), note: "500-series EQ with Air Band" },
  { id: "manley-massive-passive", brand: "Manley", model: "Massive Passive", category: "outboard", priceCents: D(5500), note: "Stereo tube EQ" },

  // ── Consoles ─────────────────────────────────────────────
  { id: "ssl-origin", brand: "Solid State Logic", model: "Origin", category: "console", priceCents: D(34999), note: "32-channel inline analogue" },
  { id: "ssl-aws-948", brand: "Solid State Logic", model: "AWS 948 δelta", category: "console", priceCents: D(89999), note: "48-ch hybrid console" },
  { id: "ssl-xl-desk", brand: "Solid State Logic", model: "XL-Desk", category: "console", priceCents: D(11999), note: "16-ch 500-series-ready" },
  { id: "ssl-big-six", brand: "Solid State Logic", model: "BiG SiX", category: "console", priceCents: D(3499), note: "Compact mixer/interface" },
  { id: "ssl-six", brand: "Solid State Logic", model: "SiX", category: "console", priceCents: D(1699), note: "Desktop mixer" },
  { id: "api-the-box-2", brand: "API", model: "The Box 2", category: "console", priceCents: D(28950), note: "Recording/mixing console" },
  { id: "api-1608-ii", brand: "API", model: "1608-II", category: "console", priceCents: D(54000), note: "16-channel console" },
  { id: "neve-8424", brand: "AMS Neve", model: "8424", category: "console", priceCents: D(39950), note: "24-fader console" },
  { id: "audient-asp4816", brand: "Audient", model: "ASP4816", category: "console", priceCents: D(7999), note: "Compact recording console" },
  { id: "rnd-5088", brand: "Rupert Neve Designs", model: "5088", category: "console", priceCents: D(60000), note: "Modular analogue console" },
  { id: "trident-88", brand: "Trident", model: "88", category: "console", priceCents: D(45000) },

  // ── Studio monitors ──────────────────────────────────────
  { id: "yamaha-hs5", brand: "Yamaha", model: "HS5", category: "monitor", priceCents: D(229), note: "5-inch (each)" },
  { id: "yamaha-hs7", brand: "Yamaha", model: "HS7", category: "monitor", priceCents: D(319), note: "6.5-inch (each)" },
  { id: "yamaha-hs8", brand: "Yamaha", model: "HS8", category: "monitor", priceCents: D(399), note: "8-inch (each)" },
  { id: "yamaha-hs8s", brand: "Yamaha", model: "HS8S", category: "monitor", priceCents: D(549), note: "8-inch subwoofer" },
  { id: "krk-rokit-5-g5", brand: "KRK", model: "Rokit RP5 G5", category: "monitor", priceCents: D(199), note: "5-inch (each)" },
  { id: "krk-rokit-7-g5", brand: "KRK", model: "Rokit RP7 G5", category: "monitor", priceCents: D(259), note: "7-inch (each)" },
  { id: "krk-rokit-8-g5", brand: "KRK", model: "Rokit RP8 G5", category: "monitor", priceCents: D(299), note: "8-inch (each)" },
  { id: "adam-t5v", brand: "Adam Audio", model: "T5V", category: "monitor", priceCents: D(199), note: "5-inch (each)" },
  { id: "adam-t7v", brand: "Adam Audio", model: "T7V", category: "monitor", priceCents: D(249), note: "7-inch (each)" },
  { id: "adam-a7v", brand: "Adam Audio", model: "A7V", category: "monitor", priceCents: D(799), note: "7-inch (each)" },
  { id: "adam-a8h", brand: "Adam Audio", model: "A8H", category: "monitor", priceCents: D(1299), note: "8-inch (each)" },
  { id: "genelec-8010a", brand: "Genelec", model: "8010A", category: "monitor", priceCents: D(395), note: "3-inch (each)" },
  { id: "genelec-8030c", brand: "Genelec", model: "8030C", category: "monitor", priceCents: D(750), note: "5-inch (each)" },
  { id: "genelec-8040b", brand: "Genelec", model: "8040B", category: "monitor", priceCents: D(1095), note: "6.5-inch (each)" },
  { id: "genelec-8050b", brand: "Genelec", model: "8050B", category: "monitor", priceCents: D(1695), note: "8-inch (each)" },
  { id: "genelec-8341a", brand: "Genelec", model: "8341A (The Ones)", category: "monitor", priceCents: D(2999), note: "Coaxial 3-way (each)" },
  { id: "focal-alpha-65-evo", brand: "Focal", model: "Alpha 65 Evo", category: "monitor", priceCents: D(349), note: "6.5-inch (each)" },
  { id: "focal-shape-65", brand: "Focal", model: "Shape 65", category: "monitor", priceCents: D(599), note: "6.5-inch (each)" },
  { id: "focal-solo6", brand: "Focal", model: "Solo6", category: "monitor", priceCents: D(1199), note: "6.5-inch (each)" },
  { id: "focal-twin6", brand: "Focal", model: "Twin6", category: "monitor", priceCents: D(1999), note: "Dual 6.5-inch (each)" },
  { id: "neumann-kh120-ii", brand: "Neumann", model: "KH 120 II", category: "monitor", priceCents: D(949), note: "5.25-inch (each)" },
  { id: "neumann-kh150", brand: "Neumann", model: "KH 150", category: "monitor", priceCents: D(1500), note: "6.5-inch DSP (each)" },
  { id: "jbl-305p-mkii", brand: "JBL", model: "305P MkII", category: "monitor", priceCents: D(149), note: "5-inch (each)" },
  { id: "jbl-308p-mkii", brand: "JBL", model: "308P MkII", category: "monitor", priceCents: D(229), note: "8-inch (each)" },
  { id: "kali-lp6-v2", brand: "Kali Audio", model: "LP-6 V2", category: "monitor", priceCents: D(199), note: "6.5-inch (each)" },
  { id: "kali-in8-v2", brand: "Kali Audio", model: "IN-8 V2", category: "monitor", priceCents: D(399), note: "3-way coaxial (each)" },
  { id: "dynaudio-lyd-7", brand: "Dynaudio", model: "LYD 7", category: "monitor", priceCents: D(549), note: "7-inch (each)" },
  { id: "presonus-eris-e5", brand: "PreSonus", model: "Eris E5", category: "monitor", priceCents: D(159), note: "5-inch (each)" },

  // ── Headphones ───────────────────────────────────────────
  { id: "sony-mdr-7506", brand: "Sony", model: "MDR-7506", category: "headphones", priceCents: D(99), note: "Closed-back studio standard" },
  { id: "beyer-dt770-pro", brand: "Beyerdynamic", model: "DT 770 PRO", category: "headphones", priceCents: D(159), note: "Closed-back" },
  { id: "beyer-dt990-pro", brand: "Beyerdynamic", model: "DT 990 PRO", category: "headphones", priceCents: D(159), note: "Open-back" },
  { id: "beyer-dt1990-pro", brand: "Beyerdynamic", model: "DT 1990 PRO", category: "headphones", priceCents: D(599), note: "Open-back reference" },
  { id: "at-ath-m50x", brand: "Audio-Technica", model: "ATH-M50x", category: "headphones", priceCents: D(169), note: "Closed-back" },
  { id: "at-ath-m40x", brand: "Audio-Technica", model: "ATH-M40x", category: "headphones", priceCents: D(99) },
  { id: "sennheiser-hd280-pro", brand: "Sennheiser", model: "HD 280 PRO", category: "headphones", priceCents: D(100), note: "Closed-back" },
  { id: "sennheiser-hd600", brand: "Sennheiser", model: "HD 600", category: "headphones", priceCents: D(399), note: "Open-back reference" },
  { id: "sennheiser-hd650", brand: "Sennheiser", model: "HD 650", category: "headphones", priceCents: D(499), note: "Open-back reference" },
  { id: "sennheiser-hd490-pro", brand: "Sennheiser", model: "HD 490 PRO", category: "headphones", priceCents: D(399), note: "Open-back, mixing" },
  { id: "akg-k371", brand: "AKG", model: "K371", category: "headphones", priceCents: D(149), note: "Closed-back" },
  { id: "akg-k240-studio", brand: "AKG", model: "K240 Studio", category: "headphones", priceCents: D(69), note: "Semi-open" },
  { id: "akg-k702", brand: "AKG", model: "K702", category: "headphones", priceCents: D(229), note: "Open-back reference" },

  // ── Synthesizers / keyboards ─────────────────────────────
  { id: "moog-subsequent-37", brand: "Moog", model: "Subsequent 37", category: "synth", priceCents: D(1799), note: "Analog mono/paraphonic" },
  { id: "moog-matriarch", brand: "Moog", model: "Matriarch", category: "synth", priceCents: D(2199), note: "Semi-modular paraphonic" },
  { id: "moog-grandmother", brand: "Moog", model: "Grandmother", category: "synth", priceCents: D(999), note: "Semi-modular analog" },
  { id: "moog-minimoog-model-d", brand: "Moog", model: "Minimoog Model D", category: "synth", priceCents: D(4999), imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Minimoog.JPG/960px-Minimoog.JPG", imageCredit: "Krash / Wikimedia Commons, public domain" },
  { id: "moog-mother-32", brand: "Moog", model: "Mother-32", category: "synth", priceCents: D(699), note: "Semi-modular eurorack" },
  { id: "sequential-prophet-6", brand: "Sequential", model: "Prophet-6", category: "synth", priceCents: D(3299), note: "6-voice analog" },
  { id: "sequential-prophet-10", brand: "Sequential", model: "Prophet-10", category: "synth", priceCents: D(4499) },
  { id: "sequential-take-5", brand: "Sequential", model: "Take 5", category: "synth", priceCents: D(1499) },
  { id: "sequential-ob6", brand: "Sequential", model: "OB-6", category: "synth", priceCents: D(3299) },
  { id: "oberheim-ob-x8", brand: "Oberheim", model: "OB-X8", category: "synth", priceCents: D(4999) },
  { id: "roland-juno-x", brand: "Roland", model: "JUNO-X", category: "synth", priceCents: D(2199) },
  { id: "roland-jupiter-xm", brand: "Roland", model: "JUPITER-Xm", category: "synth", priceCents: D(1499) },
  { id: "roland-fantom-8", brand: "Roland", model: "FANTOM-8", category: "synth", priceCents: D(3899), note: "88-key workstation" },
  { id: "roland-sh4d", brand: "Roland", model: "SH-4d", category: "synth", priceCents: D(649), note: "Desktop synth" },
  { id: "korg-minilogue-xd", brand: "Korg", model: "minilogue xd", category: "synth", priceCents: D(649), note: "4-voice analog/digital", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Korg_Minilogue.jpg/960px-Korg_Minilogue.jpg", imageCredit: "Aeternus / Wikimedia Commons, CC BY-SA 4.0" },
  { id: "korg-wavestate", brand: "Korg", model: "wavestate", category: "synth", priceCents: D(799) },
  { id: "korg-opsix", brand: "Korg", model: "opsix", category: "synth", priceCents: D(799), note: "FM synth" },
  { id: "korg-nautilus-61", brand: "Korg", model: "Nautilus 61", category: "synth", priceCents: D(2499), note: "Workstation" },
  { id: "nord-stage-4-88", brand: "Nord", model: "Stage 4 88", category: "synth", priceCents: D(5499), note: "88-key stage keyboard" },
  { id: "nord-lead-a1", brand: "Nord", model: "Lead A1", category: "synth", priceCents: D(1899) },
  { id: "nord-wave-2", brand: "Nord", model: "Wave 2", category: "synth", priceCents: D(2399) },
  { id: "nord-piano-5-88", brand: "Nord", model: "Piano 5 88", category: "synth", priceCents: D(3499), note: "Stage piano" },
  { id: "arturia-polybrute", brand: "Arturia", model: "PolyBrute", category: "synth", priceCents: D(2999), note: "6-voice analog morphing" },
  { id: "arturia-minifreak", brand: "Arturia", model: "MiniFreak", category: "synth", priceCents: D(599), note: "6-voice hybrid" },
  { id: "yamaha-montage-m8x", brand: "Yamaha", model: "MONTAGE M8x", category: "synth", priceCents: D(4499), note: "88-key flagship synth" },
  { id: "novation-summit", brand: "Novation", model: "Summit", category: "synth", priceCents: D(2099), note: "16-voice hybrid" },
  { id: "asm-hydrasynth", brand: "ASM", model: "Hydrasynth", category: "synth", priceCents: D(1299), note: "Wave-morphing digital" },
  { id: "te-op1-field", brand: "Teenage Engineering", model: "OP-1 field", category: "synth", priceCents: D(1999), note: "Portable synth/sampler" },

  // ── MIDI controllers ─────────────────────────────────────
  { id: "akai-mpk-mini-mk3", brand: "Akai", model: "MPK Mini MK3", category: "midi", priceCents: D(119), note: "25-key + pads" },
  { id: "akai-mpk249", brand: "Akai", model: "MPK249", category: "midi", priceCents: D(399), note: "49-key + pads" },
  { id: "akai-mpk261", brand: "Akai", model: "MPK261", category: "midi", priceCents: D(499), note: "61-key + pads" },
  { id: "akai-apc40-mk2", brand: "Akai", model: "APC40 MkII", category: "midi", priceCents: D(399), note: "Ableton clip controller" },
  { id: "arturia-keylab-49-mk3", brand: "Arturia", model: "KeyLab 49 MkIII", category: "midi", priceCents: D(299), note: "49-key controller" },
  { id: "arturia-keylab-61-mk3", brand: "Arturia", model: "KeyLab 61 MkIII", category: "midi", priceCents: D(399) },
  { id: "arturia-keylab-88-mk2", brand: "Arturia", model: "KeyLab 88 MkII", category: "midi", priceCents: D(899), note: "88 weighted keys" },
  { id: "arturia-minilab-3", brand: "Arturia", model: "MiniLab 3", category: "midi", priceCents: D(109), note: "25-key mini" },
  { id: "arturia-keystep", brand: "Arturia", model: "KeyStep", category: "midi", priceCents: D(119), note: "Keyboard + sequencer" },
  { id: "ni-komplete-kontrol-s49-mk3", brand: "Native Instruments", model: "Komplete Kontrol S49 MK3", category: "midi", priceCents: D(749) },
  { id: "ni-komplete-kontrol-s88-mk3", brand: "Native Instruments", model: "Komplete Kontrol S88 MK3", category: "midi", priceCents: D(1399), note: "88 weighted keys" },
  { id: "ni-komplete-kontrol-m32", brand: "Native Instruments", model: "Komplete Kontrol M32", category: "midi", priceCents: D(139) },
  { id: "ni-komplete-kontrol-a61", brand: "Native Instruments", model: "Komplete Kontrol A61", category: "midi", priceCents: D(269) },
  { id: "novation-launchkey-49-mk4", brand: "Novation", model: "Launchkey 49 MK4", category: "midi", priceCents: D(249) },
  { id: "novation-launchpad-x", brand: "Novation", model: "Launchpad X", category: "midi", priceCents: D(199), note: "Grid clip controller" },
  { id: "ableton-push-3", brand: "Ableton", model: "Push 3 (controller)", category: "midi", priceCents: D(999), note: "Grid/pad controller" },
  { id: "m-audio-oxygen-pro-49", brand: "M-Audio", model: "Oxygen Pro 49", category: "midi", priceCents: D(199) },

  // ── Monitor controllers ──────────────────────────────────
  { id: "mackie-big-knob-studio", brand: "Mackie", model: "Big Knob Studio", category: "monitor_controller", priceCents: D(249), note: "Monitor controller + interface" },
  { id: "ssl-uf8", brand: "Solid State Logic", model: "UF8", category: "monitor_controller", priceCents: D(1299), note: "DAW control surface" },
  { id: "presonus-monitor-station-v2", brand: "PreSonus", model: "Monitor Station V2", category: "monitor_controller", priceCents: D(229) },
  { id: "heritage-baby-rams", brand: "Heritage Audio", model: "Baby RAM", category: "monitor_controller", priceCents: D(199), note: "Desktop monitor controller" },

  // ── Instruments / other ──────────────────────────────────
  { id: "fender-player-strat", brand: "Fender", model: "Player Stratocaster", category: "instrument", priceCents: D(799), note: "Electric guitar" },
  { id: "gibson-les-paul-standard", brand: "Gibson", model: "Les Paul Standard '60s", category: "instrument", priceCents: D(2799), note: "Electric guitar", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Full_front_R9_Les_Paul.jpg/960px-Full_front_R9_Les_Paul.jpg", imageCredit: "Lightburst / Wikimedia Commons, CC BY-SA 4.0" },
  { id: "fender-player-jazz-bass", brand: "Fender", model: "Player Jazz Bass", category: "instrument", priceCents: D(899), note: "Electric bass", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Fender_Jazz_Bass.jpg/960px-Fender_Jazz_Bass.jpg", imageCredit: "BrianReading / Wikimedia Commons, CC BY-SA 4.0" },
  { id: "roland-tr-8s", brand: "Roland", model: "TR-8S", category: "instrument", priceCents: D(799), note: "Rhythm/drum machine" },
  { id: "elektron-digitakt-ii", brand: "Elektron", model: "Digitakt II", category: "instrument", priceCents: D(999), note: "Drum machine/sampler" },
  { id: "akai-mpc-one-plus", brand: "Akai", model: "MPC One+", category: "instrument", priceCents: D(749), note: "Standalone production center" },
  { id: "nord-drum-3p", brand: "Nord", model: "Drum 3P", category: "instrument", priceCents: D(699), note: "Drum synth" },
];

/** Lowercase haystack for matching. */
function hay(it: GearCatalogItem): string {
  return `${it.brand} ${it.model} ${it.modelNumber ?? ""} ${it.note ?? ""}`.toLowerCase();
}

/**
 * Search the catalog by free text (brand/model/note), optionally filtered by
 * category. Ranks exact brand/model prefix matches first. Pure - safe to call
 * from a Convex query or a test.
 */
export function searchGearCatalog(
  query: string,
  category?: string,
  limit = 20,
): GearCatalogItem[] {
  const pool = category
    ? GEAR_CATALOG.filter((it) => it.category === category)
    : GEAR_CATALOG;
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...pool].sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)).slice(0, limit);
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const qNo = q.replace(/\s+/g, "");
  const scored = pool
    .map((it) => {
      const h = hay(it);
      const hNo = h.replace(/\s+/g, ""); // space-insensitive: "u87" matches "U 87"
      const label = `${it.brand} ${it.model}`.toLowerCase();
      // All terms must appear somewhere (with or without spaces).
      if (!terms.every((t) => h.includes(t) || hNo.includes(t.replace(/\s+/g, "")))) return null;
      let score = 0;
      if (label.startsWith(q)) score += 100;
      if (it.brand.toLowerCase().startsWith(terms[0])) score += 40;
      if (label.includes(q) || hNo.includes(qNo)) score += 20;
      score += terms.length; // more matched terms = slightly better
      return { it, score };
    })
    .filter((x): x is { it: GearCatalogItem; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.it.brand.localeCompare(b.it.brand));
  return scored.slice(0, limit).map((x) => x.it);
}
