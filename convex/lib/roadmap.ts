/* ============================================================
   What is not built yet.

   Kept alongside the module registry so the preview page tells one
   consistent story: MODULES is what ships today, this is what is on
   the board. Anything that graduates moves from here to there.
   ============================================================ */

export type RoadmapKind = "category" | "gtm" | "finishing";

export type RoadmapItem = {
  id: string;
  kind: RoadmapKind;
  title: string;
  body: string;
  why: string;
  /** Set once the work has actually started, so the page never over-promises. */
  status: "planned" | "in_progress" | "shipped";
};

export const KIND_LABELS: Record<RoadmapKind, string> = {
  category: "Category move",
  gtm: "Go to market",
  finishing: "Finishing work",
};

export const ROADMAP: RoadmapItem[] = [
  {
    id: "directory",
    kind: "category",
    status: "shipped",
    title: "Find a Studio on Pulse",
    body: "A free, SEO-driven directory of Pulse studios with live availability. Artists search, see real open hours, and book straight through.",
    why: "Studiotime is dead and Stufinder takes ten percent. This turns Pulse from a cost line into a lead source, which is the one thing every owner says they need.",
  },
  {
    id: "payouts",
    kind: "category",
    status: "shipped",
    title: "Engineer payout automation",
    body: "Session ends, the engineer's cut is computed from commission, hourly or points, and the payout is queued. Tied to the time clock and split sheets.",
    why: "The stickiest feature in the comparable playbook, and no studio competitor touches it. Payroll and splits already exist here to fuse.",
  },
  {
    id: "payments-tier",
    kind: "category",
    status: "shipped",
    title: "Payments-monetized entry tier",
    body: "A cheaper or free plan when payments run through Pulse, with the take rate becoming the revenue line. Later, instant payouts and studio capital.",
    why: "It removes the price objection entirely and grows with the studio instead of against it.",
  },
  {
    id: "benchmark",
    kind: "category",
    status: "shipped",
    title: "State of the Recording Studio",
    body: "An annual benchmark report from anonymized Pulse data: real rates, real utilization, real no-show numbers, by market and room type.",
    why: "Owners are starving for numbers, with rates flat four years running. It is the authority play, and nobody else holds this data.",
  },
  {
    id: "comparison",
    kind: "gtm",
    status: "shipped",
    title: "The comparison page",
    body: "A direct, factual page against the incumbent: month to month versus an annual contract, everything included versus paid calendar sync and accounting add-ons.",
    why: "The switching trigger is always a money-loss event, and the comparison is the page they land on the morning after one.",
  },
  {
    id: "migration",
    kind: "gtm",
    status: "shipped",
    title: "Migration guarantee, on the pricing page",
    body: "Free white-glove migration and live in twenty-four hours, stated as a promise where the price is.",
    why: "The best-documented reason studios do not switch is setup pain. It is cheap to honor at this scale and hard to answer.",
  },
  {
    id: "card-capture",
    kind: "finishing",
    status: "shipped",
    title: "In-page card capture",
    body: "The saved-card path and off-session charging both ship. The client-side card entry form is the remaining piece.",
    why: "No-Show Shield already works through the fee-invoice route. This shortens it to one step.",
  },
  {
    id: "funnel",
    kind: "finishing",
    status: "shipped",
    title: "Booking funnel tracker",
    body: "Page-visit events on the booking page, so the funnel from view to booked to paid can be shown end to end.",
    why: "The revenue half of the story is already there. Without visits, the page cannot say what it converted.",
  },
  {
    id: "standing-rule",
    kind: "finishing",
    status: "shipped",
    title: "Insight to standing rule",
    body: "Turn an agent suggestion into a permanent deterministic automation in one click, rather than approving the same thing every week.",
    why: "It closes the loop between the agent noticing a pattern and the studio never having to think about it again.",
  },
];
