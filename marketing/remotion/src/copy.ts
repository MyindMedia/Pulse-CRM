// All on-screen copy + infographic data in one place.
export const COPY = {
  // Kinetic-typography moments (gold words emphasized). VO speaks all lines.
  hook: { text: "You didn't get into music to babysit spreadsheets.", gold: ["music"] },
  payoff: { text: "Less chaos. More music.", gold: ["music"] },
  ctaTagline: { text: "Run your studio like a hit.", gold: ["hit"] },
  ctaUrl: "pulse.myindsound.com",
  turn: "Pulse changes that.",

  // End-card "options" — the studio functions the platform runs. Leads with
  // studio operations (sessions, bookings, money, roster) over the song angle.
  endCardOptions: ["Sessions", "Bookings", "Roster", "Payments", "Releases", "Licensing"],

  // 3D nav menu (shown in the augmented windows).
  menu: ["Songs", "Sessions", "Releases", "Payments", "Roster"],

  // Chaos -> converge infographic: scattered sources pulled into the Pulse hub.
  chaosNodes: ["Texts", "Splits", "Invoices", "Files", "DMs"],

  // Song-journey pipeline (lights up along the gold line).
  journey: ["Idea", "Demo", "Session", "Mix", "Master", "Release"],

  // Augmented windows featured per value beat.
  windows: [
    { shot: "dashboard.png", label: "Every song, one pipeline." },
    { shot: "bookings.png", label: "Every session, booked." },
    { shot: "studio.png", label: "Every release, on track." },
    { shot: "inventory.png", label: "Every dollar, accounted for." },
    { shot: "agency.png", label: "Every studio, one roof." },
  ],

  // Growth infographic — illustrative figures, not real KPIs.
  growth: {
    bars: [3, 5, 4, 7, 6, 9, 8, 11],
    line: [2, 3, 3, 5, 6, 6, 8, 10, 12],
    stats: [
      { value: 312, prefix: "", suffix: "", label: "songs tracked" },
      { value: 48, prefix: "$", suffix: "k", label: "revenue routed" },
      { value: 27, prefix: "", suffix: "", label: "sessions / week" },
    ],
  },
} as const;
