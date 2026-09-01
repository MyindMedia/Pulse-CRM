/* Sales enablement content for /mypulse.
 *
 * Source of truth: pulse-feature-catalog.html in the project root, itself
 * derived from the shipped codebase. Kept as a plain server module (no
 * "use client") so the whole list only crosses the wire once a visitor has
 * cleared the password gate - a locked visitor's page source holds nothing.
 *
 * Deliberately price-free. Plan names say what unlocks a feature; no figure
 * appears anywhere, so this page can never quote a number the pricing page
 * stopped charging. */

export type Tier = "Studio" | "Pro" | "Label";

export type Feature = {
  name: string;
  /** One line a salesperson can say out loud without rehearsing it. */
  desc: string;
  tier: Tier;
};

export type Section = {
  id: string;
  title: string;
  /** Why this section matters in a pitch, not what it contains. */
  note: string;
  items: Feature[];
};

export const SECTIONS: Section[] = [
  {
    id: "bookings",
    title: "Bookings & calendar",
    note: "The wedge. A client picks a room, picks a time and pays a deposit without anyone touching a phone.",
    items: [
      { name: "Branded booking page", desc: "A public page at the studio's own address, their logo and colors, room by room.", tier: "Studio" },
      { name: "Conflict detection", desc: "Real availability per room. The same slot cannot be sold twice.", tier: "Studio" },
      { name: "Deposit at booking", desc: "Deposit percentage set per room, taken at checkout, straight to the studio's Stripe.", tier: "Studio" },
      { name: "Add-ons at checkout", desc: "Engineer, gear, extra hours priced and sold in the same flow.", tier: "Studio" },
      { name: "Discount codes", desc: "Owner-issued codes plus the AI rate-cut generator, redeemed at checkout.", tier: "Studio" },
      { name: "Booking-page social proof", desc: "Testimonials, engineer bios and credits on the page selling the time.", tier: "Studio" },
      { name: "Referral attribution", desc: "Links carry the referring artist, so word of mouth becomes a tracked number.", tier: "Studio" },
      { name: "SMS confirmations", desc: "Instant text confirmation the moment a booking lands.", tier: "Studio" },
      { name: "One-tap book again", desc: "Rebook a returning client prefilled from their last session.", tier: "Studio" },
      { name: "Automatic waitlist", desc: "A freed slot is offered to the waitlist without anyone noticing it opened.", tier: "Studio" },
      { name: "Internal deposit links", desc: "Sessions booked by staff get the same auto-sent deposit link as public ones.", tier: "Studio" },
      { name: "Sessions calendar", desc: "Month, week and agenda views, with agenda as the phone default.", tier: "Studio" },
      { name: "Session floor actions", desc: "Extend, add gear, run a timer, log the engineer's notes, check in, rebook.", tier: "Studio" },
      { name: "Session checklists", desc: "Pre and post lists staged automatically when a session is created.", tier: "Studio" },
      { name: "Two-way Google Calendar", desc: "Real two-way sync, so a personal calendar block closes a studio slot.", tier: "Pro" },
      { name: "External calendar busy blocks", desc: "Outside calendars feed availability without exposing their contents.", tier: "Pro" },
    ],
  },
  {
    id: "money",
    title: "Money",
    note: "Pulse never holds the studio's money. Each studio connects its own Stripe and gets paid directly.",
    items: [
      { name: "Stripe Connect", desc: "The studio's own Stripe account, connected during onboarding. Pulse facilitates.", tier: "Studio" },
      { name: "Deposits and balances", desc: "Deposit, milestone and final payments tracked against every session.", tier: "Studio" },
      { name: "Card on file", desc: "Saved payment method with off-session charging for fees and no-shows.", tier: "Studio" },
      { name: "Invoices with pay links", desc: "Sent, tracked and payable in one tap by the client.", tier: "Studio" },
      { name: "Auto-invoice on completion", desc: "A session that ends with a balance invoices itself, net of what was paid.", tier: "Studio" },
      { name: "Dunning ladder", desc: "Three, seven and fourteen day reminders, then an escalation flag.", tier: "Studio" },
      { name: "Collect balance on the floor", desc: "Pay link, QR code or SMS straight from the session sheet.", tier: "Studio" },
      { name: "Payment ledger", desc: "Every payment typed and recorded, including manual and credit adjustments.", tier: "Studio" },
      { name: "Fee templates", desc: "Saved flat charges, mix per song, annual maintenance, added as invoice lines.", tier: "Studio" },
      { name: "Recovered by Pulse ledger", desc: "Forfeited deposits, fees, waitlist backfills and reminder-driven payments, totalled and recapped monthly.", tier: "Studio" },
      { name: "Tax configuration", desc: "State and rate, applied at checkout where the studio needs it.", tier: "Studio" },
      { name: "Prepaid hour packages", desc: "Blocks of studio time sold up front and drawn down as credits.", tier: "Pro" },
      { name: "Recurring memberships", desc: "Monthly plans with a public subscribe page and priority booking.", tier: "Pro" },
      { name: "Expense tracking", desc: "Costs recorded against the studio and pushed into the P&L.", tier: "Pro" },
      { name: "Room and session profitability", desc: "What each room and each session actually cleared, not just billed.", tier: "Pro" },
      { name: "Rebilling and price book", desc: "Plans an operator sells on to its own studios, with per-account overrides.", tier: "Label" },
    ],
  },
  {
    id: "noshow",
    title: "No-show & risk",
    note: "Lead with this. A no-show stops being a loss and becomes a charge and a refilled slot.",
    items: [
      { name: "Cancellation policy", desc: "Windows and fee percentages set per studio and per room.", tier: "Studio" },
      { name: "Deposit forfeit", desc: "A late cancel or no-show keeps the deposit, automatically, by the stated policy.", tier: "Studio" },
      { name: "Auto-charge no-show fee", desc: "The card on file is charged off-session against the policy.", tier: "Studio" },
      { name: "Automatic client message", desc: "The awkward text nobody sends gets sent, in the studio's voice.", tier: "Studio" },
      { name: "Waitlist on no-show", desc: "The freed hours are offered out immediately, not just on a cancellation.", tier: "Studio" },
      { name: "Booking risk scoring", desc: "Which bookings are likely to fall over, before they do.", tier: "Studio" },
      { name: "Operational guardrails", desc: "A detector reading live records for the money problems nobody has spotted yet.", tier: "Pro" },
    ],
  },
  {
    id: "clients",
    title: "Clients & CRM",
    note: "Every artist, lead and collaborator in one directory, with the whole history attached.",
    items: [
      { name: "Client and artist directory", desc: "Clients, artists and leads in one roster with full profiles.", tier: "Studio" },
      { name: "Client timeline", desc: "Every message, booking, invoice and note against one person, in order.", tier: "Studio" },
      { name: "Tags and custom fields", desc: "The studio's own way of sorting people, not ours.", tier: "Studio" },
      { name: "Client CSV import", desc: "Bring the existing list in on day one.", tier: "Studio" },
      { name: "Client portal", desc: "A magic-link page where the artist rebooks, pays open invoices and downloads approved mixes.", tier: "Studio" },
      { name: "Guest collaborator passes", desc: "Scoped, expiring links for a session bassist, an outside mixer, a sync supervisor.", tier: "Studio" },
      { name: "Review requests", desc: "Sent a day after the session, captured as testimonials for the booking page.", tier: "Studio" },
      { name: "Referral loop", desc: "The review ask carries a referral link, attributed back to the artist who sent it.", tier: "Studio" },
      { name: "Pipeline board", desc: "Inquiry, qualified, proposal, booked, in session, delivered, upsell.", tier: "Pro" },
      { name: "Opportunity tracking", desc: "Value and probability on every open deal.", tier: "Pro" },
    ],
  },
  {
    id: "staff",
    title: "Staff & scheduling",
    note: "The reason a staffed studio moves up a plan. Booking an engineer onto a session schedules them, with no second step.",
    items: [
      { name: "Weekly shift grid", desc: "Staff against days, tagged by room, editable inline.", tier: "Pro" },
      { name: "Shifts from sessions", desc: "Booking an engineer creates their shift automatically.", tier: "Pro" },
      { name: "Soft double-book warning", desc: "Warns on a staffing clash and never blocks the booking.", tier: "Pro" },
      { name: "Staff availability", desc: "Each teammate sets the hours they can work, weekly.", tier: "Pro" },
      { name: "Time off", desc: "Requests from staff, an approval inbox for managers, notifications both ways.", tier: "Pro" },
      { name: "Who is working today", desc: "A dashboard strip showing the floor at a glance.", tier: "Pro" },
      { name: "Mobile time clock", desc: "Self-service clock in and out from a phone, with the pay rate frozen at punch.", tier: "Pro" },
      { name: "Payroll", desc: "Hours against rates, salary prorated, engineer cuts, posted as a labor expense.", tier: "Pro" },
      { name: "Pay periods", desc: "Monthly or rolling biweekly against an anchor date.", tier: "Pro" },
      { name: "Staff onboarding", desc: "Branded invite, role intro, profile photo, availability. Then they are working.", tier: "Pro" },
      { name: "Per-member notifications", desc: "An activity bell and alerts scoped to what that person actually does.", tier: "Pro" },
    ],
  },
  {
    id: "floor",
    title: "Floor & front desk",
    note: "What the studio looks at between ten in the morning and midnight.",
    items: [
      { name: "Today command center", desc: "Today's sessions in order, who is in which room and until when, arrivals, balances due, staff on shift, tomorrow.", tier: "Studio" },
      { name: "Arrival prep", desc: "A shared checklist for the next client walking in, live across every staff device.", tier: "Studio" },
      { name: "Room status", desc: "Free, busy, and busy until when, computed from real sessions.", tier: "Studio" },
      { name: "Engineering logs", desc: "Gear settings, signal chain, BPM, key, recorded against the session.", tier: "Studio" },
      { name: "Installable mobile app", desc: "A PWA with its own tab bar, on the home screen, no app store.", tier: "Studio" },
      { name: "Push notifications", desc: "Web push to staff devices for the things that cannot wait for email.", tier: "Studio" },
      { name: "Visitor check-in kiosk", desc: "A QR page and front-desk guest log, so the studio knows who is in the building.", tier: "Pro" },
      { name: "Printable check-in sign", desc: "A branded sign with the studio's QR, ready to print and frame.", tier: "Pro" },
      { name: "Reserved parking badge", desc: "A named badge for the client's spot. Small thing, remembered every time.", tier: "Pro" },
    ],
  },
  {
    id: "gear",
    title: "Gear, rooms & patch",
    note: "The part no generic CRM has: what is in the room, what it is worth, and what it is plugged into.",
    items: [
      { name: "Room management", desc: "Rooms with photos, hourly rates, deposit rules and service pricing.", tier: "Studio" },
      { name: "Equipment inventory", desc: "Every piece of gear with photos, taken from the phone or the library.", tier: "Pro" },
      { name: "Maintenance tracking", desc: "What needs servicing, and what has been.", tier: "Pro" },
      { name: "Gear rentals", desc: "Kit rented out, tracked and billed like any other line.", tier: "Pro" },
      { name: "Inventory import", desc: "The existing gear spreadsheet, in from Excel or CSV.", tier: "Pro" },
      { name: "Software licenses", desc: "Plugin and DAW subscriptions tracked with their renewal costs.", tier: "Label" },
      { name: "Patchbay manager", desc: "Spaces, devices, ports and connections. The real signal routing, documented.", tier: "Label" },
      { name: "Device profiles", desc: "One profile per model, reused across every instance in the building.", tier: "Label" },
      { name: "I/O spec lookup", desc: "Look up what a port actually is, without opening the manual.", tier: "Label" },
      { name: "Configure I/O from a spec sheet", desc: "Point at the spec, get the device's inputs and outputs configured.", tier: "Label" },
      { name: "Patch annotations and audit", desc: "Notes, groups and a full history of who repatched what.", tier: "Label" },
    ],
  },
  {
    id: "catalog",
    title: "Music & catalog",
    note: "The work is the record, not just the appointment. Pulse tracks both.",
    items: [
      { name: "Deliverables", desc: "Versioned mixes with client approval and download. Ends the WeTransfer habit.", tier: "Studio" },
      { name: "Revision comments", desc: "Notes against a specific version, so feedback stops living in text messages.", tier: "Studio" },
      { name: "Song catalog", desc: "Every song with cover art, status and the sessions that made it.", tier: "Pro" },
      { name: "Streaming link import", desc: "Paste a link, get the artwork and metadata filled in.", tier: "Pro" },
      { name: "Split sheets", desc: "Ownership percentages agreed and recorded per song.", tier: "Label" },
      { name: "Real e-signatures", desc: "Collaborators sign the split by link. Signed means signed.", tier: "Label" },
      { name: "Split prefill from credits", desc: "The people already on the song are already on the sheet.", tier: "Label" },
      { name: "Release campaigns", desc: "Rollout planned and tracked from planning through released.", tier: "Label" },
      { name: "Licensing", desc: "Sync and beat licenses with tiers from MP3 through exclusive.", tier: "Label" },
      { name: "Rights export", desc: "The ownership picture, exportable, when a publisher asks.", tier: "Label" },
    ],
  },
  {
    id: "ai",
    title: "The AI layer",
    note: "Not a chatbot bolted on. An ops manager that reads the studio's real data, proposes actions, and waits for a yes.",
    items: [
      { name: "Prompt-injection guardrails", desc: "Untrusted client text is fenced, and the agent is bound to one tenant's data.", tier: "Studio" },
      { name: "Pulse Agent", desc: "A conversational ops manager per studio, grounded in that studio's own records.", tier: "Pro" },
      { name: "Approval-first execution", desc: "Nothing client-facing or financial goes out without an explicit yes.", tier: "Pro" },
      { name: "Daily brief", desc: "What happened, what needs attention, delivered at the studio's chosen hour.", tier: "Pro" },
      { name: "Studio health score", desc: "Six deterministic components, so the number means the same thing every day.", tier: "Pro" },
      { name: "Agent memory", desc: "What the owner told it once, remembered.", tier: "Pro" },
      { name: "Agent audit and metering", desc: "Append-only log of every action, plus credit usage per workspace.", tier: "Pro" },
      { name: "AI SMS receptionist", desc: "Answers inbound booking texts around the clock with the booking link. Never confirms a slot it cannot hold.", tier: "Pro" },
      { name: "Ops Autopilot", desc: "A scheduled operations brain deriving candidate actions from live state.", tier: "Pro" },
      { name: "Studio Brain", desc: "A knowledge graph of artists, songs, sessions, rooms, gear and staff, and how they connect.", tier: "Pro" },
      { name: "Predictive intelligence", desc: "Forecasts grounded in the studio's own history, not a generic prior.", tier: "Pro" },
      { name: "Insight feed", desc: "The nudges worth reading, ranked, with the reasoning shown.", tier: "Pro" },
      { name: "AI drafts and artifacts", desc: "Emails, recaps and offers drafted for a human to send.", tier: "Pro" },
      { name: "Controlled autonomy", desc: "Low-risk reminders run themselves once the owner turns it on. Nothing else does.", tier: "Label" },
      { name: "Recurring agent automations", desc: "A saved prompt the agent runs daily or weekly, producing insights like any other run.", tier: "Label" },
      { name: "Agent fleet", desc: "Every studio's agent, health and pending approvals from one console.", tier: "Label" },
    ],
  },
  {
    id: "comms",
    title: "Communication",
    note: "The studio chooses whether client mail leaves from its own Gmail or from Pulse.",
    items: [
      { name: "Pulse email", desc: "Transactional and client mail sent by Pulse, working from the first minute.", tier: "Studio" },
      { name: "SMS", desc: "Texting with carrier registration handled, so messages actually arrive.", tier: "Studio" },
      { name: "Opt-out handling", desc: "A stop is honored permanently and logged.", tier: "Studio" },
      { name: "Reminder sequences", desc: "Forty-eight hours, twenty-four hours, two hours. The single biggest lever on no-shows.", tier: "Studio" },
      { name: "Client message threads", desc: "The conversation with a client kept against the client, not in someone's phone.", tier: "Studio" },
      { name: "Team notifications", desc: "The right staff told about the thing that just happened.", tier: "Studio" },
      { name: "Send from your Gmail", desc: "Connect Google and client mail leaves from the studio's real address.", tier: "Pro" },
      { name: "Unified inbox", desc: "Approvals and conversations in one place instead of five.", tier: "Pro" },
    ],
  },
  {
    id: "reporting",
    title: "Reporting",
    note: "Studio owners run thin margins and mostly cannot say which room earns. This is where that changes.",
    items: [
      { name: "Revenue command center", desc: "The month, the trend, and where it came from.", tier: "Pro" },
      { name: "Operating KPIs", desc: "Lead response time, booking rate, no-show percentage, overdue invoices.", tier: "Pro" },
      { name: "Customizable dashboard", desc: "A widget grid the owner arranges around how they actually work.", tier: "Pro" },
      { name: "Revenue and pipeline charts", desc: "Trend over time and distribution across stages.", tier: "Pro" },
      { name: "Booking funnel", desc: "What the booking page earned, and from how many new clients.", tier: "Pro" },
      { name: "Usage panel", desc: "AI credits, storage, SMS and email against the plan's included amounts.", tier: "Pro" },
      { name: "Data exports", desc: "The studio's numbers, out, whenever it wants them.", tier: "Pro" },
    ],
  },
  {
    id: "brand",
    title: "Branding & white label",
    note: "Upload a logo and the app rethemes to the studio's colors. At the top plan, the whole product wears their brand.",
    items: [
      { name: "Logo-driven theming", desc: "Drop in the logo, the brand colors are extracted, the app rethemes live.", tier: "Studio" },
      { name: "Booking page hero", desc: "Upload a photo, or have one generated that looks like a brand shot it.", tier: "Studio" },
      { name: "Booking page copy", desc: "Headline, intro and deposit policy in the studio's own words.", tier: "Studio" },
      { name: "Accent and palette", desc: "A brand accent applied across client-facing surfaces.", tier: "Studio" },
      { name: "In-app studio branding", desc: "Their logo and accent inside the app their team uses all day.", tier: "Pro" },
      { name: "Full white-label UI", desc: "Palette, typography, corner radius and density. Their design language, not ours.", tier: "Label" },
      { name: "Branded sign-in", desc: "Their headline, their copy, their background on the door.", tier: "Label" },
      { name: "Branded email skin", desc: "Transactional mail in their colors, signed off in their words.", tier: "Label" },
      { name: "Custom domain", desc: "The whole app on the studio's own address.", tier: "Label" },
      { name: "Readability floor", desc: "Custom palettes are held to WCAG contrast, so nobody ships an unreadable app.", tier: "Label" },
      { name: "Powered by Pulse", desc: "A small lockup under their logo. Part of the plan, not a setting, at any tier.", tier: "Label" },
    ],
  },
  {
    id: "agency",
    title: "Agency & multi-studio",
    note: "One command center over many studios, each fully isolated from the others.",
    items: [
      { name: "Agency console", desc: "Every studio, its health, its numbers, from one screen.", tier: "Label" },
      { name: "Invite a studio", desc: "Send an email, they get a branded onboarding and are taking bookings that day.", tier: "Label" },
      { name: "Guided studio onboarding", desc: "Logo, business details, booking copy, Stripe, email, first room. Resumable.", tier: "Label" },
      { name: "Import from their website", desc: "Pull a new studio's details straight off the site they already have.", tier: "Label" },
      { name: "Per-studio feature toggles", desc: "Switch surfaces off for one studio without touching another.", tier: "Label" },
      { name: "Price book", desc: "The plans an operator sells on, with trials, promos and per-account terms.", tier: "Label" },
      { name: "Scoped agency staff", desc: "Team members who can only see the studios they are assigned.", tier: "Label" },
      { name: "Agency branding", desc: "The console and its studios under the operator's own brand and domain.", tier: "Label" },
      { name: "Cross-studio approvals", desc: "Everything waiting on a human, across the whole fleet, in one queue.", tier: "Label" },
      { name: "Agency audit", desc: "Who did what, in which studio, when.", tier: "Label" },
      { name: "Demo data switch", desc: "Fill a sub-account with realistic data for a pitch, then clear it.", tier: "Label" },
    ],
  },
  {
    id: "platform",
    title: "Platform & security",
    note: "Every read is scoped to one studio. Cross-studio access is denied at the engine, not the screen.",
    items: [
      { name: "Tenant isolation", desc: "Every query scoped by studio; files served only to their own workspace.", tier: "Studio" },
      { name: "Access engine", desc: "One resolver, one permission check, one audit hook. Every function goes through it.", tier: "Studio" },
      { name: "Role-based permissions", desc: "Owner, manager, engineer, staff and guest, each seeing only their surface.", tier: "Studio" },
      { name: "Plan entitlement gate", desc: "What was bought is enforced inside the access engine, not just hidden in the nav.", tier: "Studio" },
      { name: "Audit trail", desc: "Append-only records of the sensitive things: refunds, approvals, invites, signatures.", tier: "Studio" },
      { name: "GDPR export and erasure", desc: "The two rights a studio has to honor for its clients, built in.", tier: "Studio" },
      { name: "Expiring magic links", desc: "Guest access that is scoped, time-boxed and revocable.", tier: "Studio" },
      { name: "Usage metering", desc: "Credits, storage and grants counted and capped per plan.", tier: "Studio" },
      { name: "Guided onboarding", desc: "Active immediately, finishable later. No hard gate before the first booking.", tier: "Studio" },
      { name: "Free migration", desc: "White-glove import and live in a day, against a category where setup takes months.", tier: "Studio" },
      { name: "Month to month", desc: "Cancel any time. No annual contract, no add-on charges, everything in the plan.", tier: "Studio" },
      { name: "955 automated tests", desc: "The money paths, the isolation boundary and the entitlement ladder, all pinned.", tier: "Studio" },
    ],
  },
];

export const TOTAL_FEATURES = SECTIONS.reduce((n, s) => n + s.items.length, 0);

/* Not shipped. On the page so a rep can answer "do you do X?" honestly and
   still sound like they know where the product is going. Never pitch as live. */
export type Roadmap = { kind: string; title: string; what: string; why: string };

export const ROADMAP: Roadmap[] = [
  {
    kind: "Category move",
    title: "Find a Studio on Pulse",
    what: "A free, SEO-driven directory of Pulse studios with live availability. Artists search, see real open hours, and book straight through.",
    why: "Turns Pulse from a cost line into a lead source, which is the one thing every owner says they need.",
  },
  {
    kind: "Category move",
    title: "Engineer payout automation",
    what: "Session ends, the engineer's cut is computed from commission, hourly or points, and the payout is queued. Tied to the time clock and split sheets.",
    why: "The stickiest feature in the comparable playbook, and no studio competitor touches it. Payroll and splits already exist here to fuse.",
  },
  {
    kind: "Category move",
    title: "Payments-monetized entry tier",
    what: "A lighter plan when payments run through Pulse, with the take rate becoming the revenue line. Later, instant payouts and studio capital.",
    why: "It removes the cost objection entirely and grows with the studio instead of against it.",
  },
  {
    kind: "Category move",
    title: "State of the Recording Studio",
    what: "An annual benchmark report from anonymized Pulse data: real rates, real utilization, real no-show numbers, by market and room type.",
    why: "Owners are starving for numbers. It is the authority play, and nobody else holds this data.",
  },
  {
    kind: "Go to market",
    title: "The comparison page",
    what: "A direct, factual page against the incumbent: month to month versus an annual contract, everything included versus paid calendar sync and accounting add-ons.",
    why: "The switching trigger is always a money-loss event, and the comparison is the page they land on the morning after one.",
  },
  {
    kind: "Go to market",
    title: "Migration guarantee, stated up front",
    what: "Free white-glove migration and live in twenty-four hours, stated as a promise on the buying page.",
    why: "The best-documented reason studios do not switch is setup pain. It is cheap to honor at this scale and hard to answer.",
  },
  {
    kind: "Finishing work",
    title: "In-page card capture",
    what: "The saved-card path and off-session charging both ship. The client-side card entry form is the remaining piece.",
    why: "No-show recovery already works through the fee-invoice route. This shortens it to one step.",
  },
  {
    kind: "Finishing work",
    title: "Booking funnel tracker",
    what: "Page-visit events on the booking page, so the funnel from view to booked to paid can be shown end to end.",
    why: "The revenue half of the story is already there. Without visits, the page cannot say what it converted.",
  },
  {
    kind: "Finishing work",
    title: "Insight to standing rule",
    what: "Turn an agent suggestion into a permanent deterministic automation in one click, rather than approving the same thing every week.",
    why: "It closes the loop between the agent noticing a pattern and the studio never having to think about it again.",
  },
];
