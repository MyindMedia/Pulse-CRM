// All on-screen copy in one place.
export const COPY = {
  coldOpen: "Your studio runs on chaos.",
  chaos: ["Spreadsheets.", "Unpaid invoices.", "Lost files.", "Endless DMs."],
  turn: "Meet Pulse.",
  // 3D nav menu shown in the augmented showcase.
  menu: ["Songs", "Sessions", "Releases", "Payments", "Roster"],
  // Augmented windows: which screenshot floats, + its label.
  windows: [
    { shot: "dashboard.png", label: "Every song, one pipeline." },
    { shot: "bookings.png", label: "Every session, booked." },
    { shot: "studio.png", label: "Every release, on track." },
    { shot: "inventory.png", label: "Every dollar, accounted for." },
    { shot: "agency.png", label: "Every studio, one roof." },
  ],
  dataViz: {
    headline: "Watch the catalog grow.",
    bars: [3, 5, 4, 7, 6, 9, 8, 11], // illustrative, not a real KPI
    line: [2, 3, 3, 5, 6, 6, 8, 10, 12],
  },
  payoff: "One place. Every song. Every session. Every dollar.",
  ctaTagline: "The studio CRM built for producers, not spreadsheets.",
  ctaUrl: "pulse.studio",
} as const;
