# Claude Code prompt: Pulse OS pricing build (Core / Growth / Max)

Paste everything inside the fence into Claude Code from the Pulse OS repo. Claude Code will look through the codebase, show you the tier checklist, and **stop for your approval** before it builds anything.
Related files: `pulse-os-tier-features.md` (editable tier checklist) and `pulse-os-pricing-research.md` (sources).

````text
You're working in my Pulse OS codebase. Pulse OS is "the studio operating system" for recording and music studios. Never call it a CRM anywhere: not in copy, metadata, keywords, or categories. The site is studiopulse.tech (Next.js app, Clerk auth). This is ONE build that replaces the old Studio/Pro/Label pricing with a new Core / Growth / Max structure across:
- the internal /mypulse sales page
- a new public pricing page
- the plan-gating code

== CONTEXT ==
- Internal page: https://studiopulse.tech/mypulse, password: (set MYPULSE_PASSWORD in Netlify)
  - It's an internal "NOT FOR FORWARDING" sales sheet: 155 built features in 14 groups, each tagged with the cheapest plan that includes it, plus 9 "Not built yet" items.
  - The feature data lives in the repo. Treat the repo copy as the source of truth for exact feature names.
- The Pulse app: our iOS companion app, already live. It lets studio owners and teams run Pulse from their phones without being at a computer. It's separate from the installable web app ("It installs on a phone").
- Everyone is on beta today and there are NO paid subscribers to preserve. This is a brand-new tier structure, so no backward compatibility is needed.
- Brand: dark UI with a yellow-gold accent. Reuse the existing tokens/components; don't introduce new colors.

== STEP 1. INSPECT, PROPOSE, THEN STOP ==
Before changing any code:
1. Map the repo and report the file paths for:
   - the existing plan/tier/entitlement definitions (keys like studio/pro/label)
   - every place a plan is checked (server and client), including "You get what you paid for" checks and "Allowances counted per plan"
   - the /mypulse page and its feature data
   - main navigation and homepage CTAs
   - Stripe/billing config and price IDs
   - the production receiver (webhooks)
   - the iOS app's API surface, or any feature flags it reads
   - the test setup (the site has 955 automatic checks)
2. Present the per-tier feature breakdown below as an EDITABLE CHECKLIST, grouped by the 14 sections with Core / Growth / Max columns.
   - Use exact names from the repo data. Flag any name that differs from my list, plus any feature in the repo that's missing from it or vice versa.
   - Mark the 8 moved features.
   - Show the current allowance numbers (assistant, storage, texts, email) and propose a Core/Growth/Max step-up. Don't invent numbers; derive them from the existing config.
   - Show what the Pulse app does per tier, confirmed from the code.
3. Ask me:
   - (a) Should beta users map to a tier, or stay on a beta flag?
   - (b) Does Core's "Daily summary" / "Studio health score" need other assistant features moved down (for example "A record of what it did" or "How much of the plan is used")?
   - (c) What's the App Store URL for the Pulse app, if it isn't in the repo?
   - (d) Is there an existing "Book a demo" route?
3b. For the three new features, give me a short build plan: data model, screens, Pulse app touchpoints, tests, and the R2 storage status for every file path.
4. Then STOP. Don't edit anything until I approve or edit the checklist. My copy of this breakdown is in pulse-os-tier-features.md (same content as below).

== PROPOSED TIERS (editable) ==
Prices (USD):
- Core: $149/mo, or $1,490/yr annual (2 months free)
- Growth: $297/mo, or $2,970/yr
- Max: $699/mo with UNLIMITED studios included, no per-studio add-on. Annual: $6,990/yr. (Lawrence's decision on the pricing structure: Max is a flat $699 with unlimited studios. Do not add per-studio charges, studio caps, or seat fees.)

All tiers:
- Month to month, no contract.
- Gate by features, not seats: no per-login fees. Roles are Owner, manager, engineer, staff, guest.
- No booking commission. Card payments go to the studio's own Stripe account; Pulse never holds the money.

Who each tier is for (reuse the page's "Who it is for / How to tell on a call" copy, renamed):
- Core: 1–2 rooms, owner-run, helpers paid per session. Up to 2 rooms. Owner plus engineer/staff logins with no payroll tools. Unlimited "Guest passes".
- Growth: payroll staff, or more than two rooms. Unlimited rooms at one location, all five roles. Managers approve time off and assistant actions. Engineers see only their own sessions. "Alerts for each person" is on.
- Max: labels, production companies, multi-studio brands. Adds a group-admin layer: "Staff who see only their studios", "Switch parts off per studio", "One approval queue for all studios", "Who did what, where". Studios never see each other ("Studios cannot see each other").
- Allowances step up per tier and are pooled across studios on Max.

Moves from the current page:
- Growth to Core: "Google Calendar, both ways", "Other calendars mark hours busy", "Send from your own Gmail", "Daily summary", "Studio health score"
- Max to Growth: "A map of the cables", "Look up what a socket does", "Software subscriptions"

Feature list. Each feature is listed under the cheapest tier that includes it; Growth includes all of Core, and Max includes all of Growth. Totals: Core 76, Growth 49, Max 30.
1. Booking and the calendar (16)
   Core: Your own booking page; No double bookings; Money paid up front; Extras at checkout; Discount codes; Reviews and credits on the page; See who sends you clients; Instant text confirmation; Book a returning client in one tap; Waiting list; Deposit links for staff bookings; The calendar; Change a session while it runs; Checklists before and after; Google Calendar, both ways; Other calendars mark hours busy
2. Money (16)
   Core: Their own card-payment account; Money paid and money owed; Saved card; Bills with a pay button; Bills that write themselves; Automatic payment reminders; Take the rest of the money in the room; Every payment recorded; Saved charges; Money Pulse won back; Sales tax
   Growth: Prepaid blocks of hours; Monthly memberships; What the studio spends; What each room really made
   Max: Your own price list
3. People who do not turn up (7)
   Core: Cancellation rules; Keep the deposit; Charge for a missed session; The awkward message, sent for you; Refill the empty hours; Which bookings look shaky
   Growth: Warnings about money problems
4. Clients (10)
   Core: One list of everyone; One person's whole history; Your own tags; Bring your list in from a spreadsheet; A private page for the client; Guest passes; Ask for a review; Turn a review into a referral
   Growth: Job board; What each open job is worth
5. Staff and shifts (11)
   Growth: The week's schedule; Booking an engineer makes their shift; Warning when someone is booked twice; Hours each person can work; Time off requests; Who is on today; Clock in on a phone; Payroll; Pay periods; New staff set themselves up; Alerts for each person
6. The front desk (9)
   Core: The today screen; Get ready for the next client; Is the room free; Notes on how the session was set up; It installs on a phone; Phone alerts
   Growth: Sign-in screen at the door; A printable sign with your code; A named parking badge
7. Rooms, gear and cables (11)
   Core: Rooms
   Growth: A list of every piece of gear; What needs servicing; Renting gear out; Bring the gear list in from a spreadsheet; Software subscriptions; A map of the cables; Look up what a socket does
   Max: Fill in a piece of gear once; Set up sockets from the maker's sheet; Notes and history on the cable map
8. Songs (10)
   Core: Finished mixes; Notes on one version of a mix
   Growth: Every song in one place; Paste a streaming link
   Max: Who owns what share of a song; Real signatures by link; The form fills itself in; A plan for putting a song out; Selling the right to use a song; Print who owns what
9. The assistant (16)
   Core: It does not take orders from a client message; Daily summary; Studio health score
   Growth: Pulse Agent; It always asks first; It remembers; A record of what it did; It answers booking texts day and night; The scheduled check (Ops Autopilot); The connection map (Studio Brain); Guesses from your own history; A short list of what matters; It writes, you send
   Max: Let simple reminders run themselves; Ask it the same thing every week; All the assistants on one screen
10. Talking to clients (8)
   Core: Email that works on day one; Text messages; STOP means stop; Reminders before the session; The conversation stays with the client; Telling the right staff; Send from your own Gmail
   Growth: One inbox
11. Numbers (7)
   Growth: How much money came in; The numbers that matter; Arrange the home screen; Charts; What the booking page earned; How much of the plan is used; Download your numbers
12. Making it look like theirs (11)
   Core: Colors from your logo; A photo at the top of the booking page; The words on the booking page; One brand color everywhere
   Growth: Their brand inside the app
   Max: The app looks like theirs; Their own login screen; Emails in their colors; Their own web address; Colors stay readable; A small Pulse mark
13. Running many studios (11)
   Max: One screen for every studio; Invite a studio by email; Step-by-step setup; Pull details off their website; Switch parts off per studio; Your own price list; Staff who see only their studios; The console under your brand; One approval queue for all studios; Who did what, where; Fake data for a pitch
14. Safety and privacy (12)
   Core: Studios cannot see each other; One place that checks permissions; Roles; You get what you paid for; A permanent record; Clients can get or delete their data; Guest links that expire; Allowances counted per plan; Use it before setup is finished; We move your data for free; No contract; 955 automatic checks

The Pulse app by tier (proposed; confirm against the code):
- Core: today's sessions, calendar, room status, take payment in the room, phone alerts, client history and texts, daily summary.
- Growth: adds clock-in, time off, the staff schedule, approving assistant drafts, gear photos, the cable map, money dashboards, scanning gear barcodes to check gear in and out, checking project status, and reviewing and approving file versions.
- Max: adds switching between studios, one screen for every studio, and the cross-studio approval queue.

NEW FEATURES TO BUILD (my decision: close the gap with Studio Hero). All three are REQUIRED and must ship complete in this build, not as optional extras, add-ons, or stubs. They need to work across the product: the web app, the Pulse iOS app, permissions, the plan config, /mypulse, and /pricing. I have no tier requirement. Place each one where it fits best (the tiers below are only a suggestion; adjust them and explain why). Include them in the Step 1 checklist as a 15th group "New: production, media and gear check-out":
- "Post-production project tracking" (Growth; Max adds a cross-studio view). Projects with stages from tracking through mixing, mastering and delivery, tasks, owners, due dates and deliverables, linked to sessions, songs, rooms, engineers and bills. Shows on "Job board"-style cards and on the today screen.
- "Media file management with version control" (Growth; Core keeps "Finished mixes" and "Notes on one version of a mix"; Max adds a library shared across studios). One searchable library for sessions, stems, mixes, masters, artwork and deliverables. Every upload is a numbered version with history, notes, and client approval. Storage allowance steps up by tier through "Allowances counted per plan".
- "Barcode equipment check-in and check-out" (Growth; builds on "A list of every piece of gear"). Print or assign barcode/QR labels, scan with the phone camera in the Pulse app or on the web to check gear in and out to a person, session or rental, show who has what and what's overdue, and keep the history on the item.

INFRASTRUCTURE SELLING POINT: All Pulse OS file hosting and versioning runs on Cloudflare R2. That covers finished mixes, the media library and its versions, stems, artwork, gear photos, signed documents and exports. In Step 1, confirm in the code which storage every file path uses. If anything isn't on R2 yet, list it and propose the R2 change; don't claim R2 publicly until that's true. Use the existing R2 env/config names, and don't commit secrets.

NEVER present any of the 9 "Not built yet" items as features anywhere public. That includes the public studio directory, automatic engineer pay, the payments-funded cheaper plan, the yearly report, the rival comparison page, typing the card number into the page, booking-page visit counts, and suggestion-to-rule.

== STEP 2. BUILD (only after I approve) ==
A. Single source of truth
   - Create ONE typed pricing/tier config with keys core | growth | max. It holds display names, prices (monthly and annual), Max's unlimited studios (no per-studio price), allowances, roles and limits, the per-feature tier map, and Pulse app capabilities.
   - /mypulse, /pricing, the plan-gating code, allowance caps, and metadata/JSON-LD all read from it.
B. Rename plans outright
   - Replace the old tier names (Studio, Pro, Label, and any other legacy plan names you find, e.g. starter/basic/premium/enterprise/beta-tier labels) with Core / Growth / Max throughout the entire system: plan keys, entitlements, the /mypulse page, the /pricing page, every UI label, badge, upgrade prompt, email template, settings/billing screen and the Pulse app. Concretely, replace them everywhere in: types, enums, DB values/migrations, gating checks, Clerk metadata reads, feature flags, tests, and copy. Remove the old plan names entirely.
   - CAREFUL: "studio" is also the core domain noun (a studio account, studio_id, etc.). Rename ONLY plan identifiers and plan labels. Never rename the studio entity.
   - Migrate beta users the way I choose in Step 1.
   - Show me any DB migration before running it against a non-local database.
C. /mypulse (stays internal)
   - Keep the password gate and noindex/nofollow intact.
   - Rename the plan cards and the filter buttons to Core / Growth / Max, and retag every row from the config.
   - Change "Pro includes everything in Studio. Label includes everything in Pro." to "Growth includes everything in Core. Max includes everything in Growth."
   - Update each plan's "What they get" copy for the moves. The Google Calendar/Gmail links now sit in Core, and the cable map and software subscriptions now sit in Growth.
   - Add a pricing block showing monthly and annual prices, Max's unlimited studios, and a per-tier access/permissions summary (roles, rooms, studios, allowances).
D. New public page /pricing
   - Link it from the main navigation and the homepage.
   - Three cards: Core, Growth, Max. Monthly/annual toggle.
   - A customer-facing comparison table built from the config, grouped by the 14 sections. Use customer-safe wording: no internal sales notes ("How to tell on a call", "Start a cold call here", "Show this part first", rival talk) and no "not built yet" items.
   - A Pulse app section: "Run your studio from your phone with the Pulse app for iPhone", showing per-tier capabilities and the App Store link (use NEXT_PUBLIC_PULSE_IOS_APP_URL if the link isn't in the repo).
   - FAQ:
     - No contract, cancel any month.
     - We move your data for free and you're running within a day.
     - Card payments go straight to your own Stripe account; Pulse never holds your money and takes no booking commission.
     - No per-seat fees.
     - Max includes unlimited studios at one flat price.
     - What happens with beta access.
   - CTAs: primary "Book a demo" (existing route), plus "Start with Core / Growth / Max" buttons wired to checkout through env-var price IDs. If the price ID isn't set, fall back to "Book a demo".
E. SEO/metadata
   - Add page metadata and keywords on /pricing and the homepage.
   - Add JSON-LD:
     - SoftwareApplication: name "Pulse OS", applicationCategory "BusinessApplication", operatingSystem "Web", with offers = 3 Offer items generated from the config (USD, monthly).
     - MobileApplication for the Pulse app (operatingSystem "iOS").
   - Never use the word CRM. Use the keywords and categories below.
F. Styling: the yellow-gold accent for the highlighted tier, toggle and CTAs, consistent with the site. Mobile responsive and accessible.
G. Billing safety
   - Do NOT create, edit or archive Stripe live products or prices. Don't change production billing config. Don't modify the production receiver.
   - Read price IDs from env vars: STRIPE_PRICE_CORE_MONTHLY, STRIPE_PRICE_CORE_ANNUAL, STRIPE_PRICE_GROWTH_MONTHLY, STRIPE_PRICE_GROWTH_ANNUAL, STRIPE_PRICE_MAX_MONTHLY, STRIPE_PRICE_MAX_ANNUAL. Add them to .env.example.
   - List exactly what I must create in Stripe (product, price, interval, amount).
   - If anything requires touching live billing or the receiver, ask me first.
I. Build the three new features (after I approve the plan)
   - Fully implement "Post-production project tracking", "Media file management with version control" and "Barcode equipment check-in and check-out" end to end (data model, web screens, Pulse app screens, notifications, permissions, tests) behind the tier gates from the config. The build isn't done until all three ship and pass tests. Keep the studio isolation rules ("Studios cannot see each other") and the single permission check.
   - All uploads and versions go to Cloudflare R2 (private buckets, signed URLs, per-studio key prefixes). Expiring guest links reuse the "Guest links that expire" logic.
   - Once all three pass tests, add them to /mypulse's built list (in plain words, with their tiers) and to the /pricing comparison table. Never list anything that isn't working.
   - /pricing: show them in the comparison table once built. Add an "Infrastructure" line/FAQ: "Every file and every version is stored on Cloudflare R2: fast, durable, and private to your studio." Show it only after you've confirmed all file hosting is on R2.
H. Verify
   - Run lint, typecheck, and the full test suite (all 955+ automatic checks) and the build.
   - Add tests that:
     - each feature's tier gate matches the config
     - no old plan keys remain (grep test)
     - /mypulse is still noindex and password-gated
     - file uploads/versions write to R2 (mocked) and stay studio-isolated
     - barcode check-out/check-in updates gear status and history
     - /pricing renders no "not built yet" items and no "CRM"
   - Finish with a PR-style summary: files changed, the migration, test results, the Stripe items for me to create, open questions, and the directory categories below.

== MARKET RESEARCH (published prices checked Oct 7, 2026; background only; don't name rivals on public pages) ==
| Tool | Plans / price | What separates the tiers | Source |
|---|---|---|---|
| Sonido (studio mgmt) | Solo $49/mo; Studio $99/mo; 4+ rooms/multi-location custom | rooms, users, storage; white-label custom-only | mysonido.com/pricing |
| Studio Hero | $205/mo for 1 seat (annual agreement), up to $880/mo for 10 users; Enterprise custom; calendar sync $75 setup | seats | thestudiohero.com/pricing |
| AudioDope | $153 / $306 / $459 / $612 / $765 per year; add-ons $5–$10/mo (calendar sync, AI, accounting) | rooms, staff | audiodope.co/pricing |
| EngineEars for Studios | Free + 15% fee on earnings; Platinum $15/mo (annual), 0% fee | fee vs subscription | engineears.com/studios |
| Jammed | £16.20/mo per bookable room; Pro +£66/mo (white-label) | per room | jammed.app/pricing |
| StudioDock | $49 / $89 per mo; +$10 per extra space | spaces, seats | getstudiodock.com/pricing |
| Peerspace | 20% host service fee | marketplace | support.peerspace.com |
| Mindbody | Starter from $79/mo per location; higher tiers quote-only | location | mindbodyonline.com/business/pricing |
| Square Appointments | $0 / $49 / $149 per mo per location | location + features | squareup.com/us/en/appointments/pricing |
| Acuity | $16–$49/mo annual ($20–$61 monthly) | calendars 1 / 6 / 36 | acuityscheduling.com |
| Vagaro | $30/mo + $10 per extra bookable calendar | calendars | vagaro.com/pro/pricing |
| Gusto (payroll) | $49 + $6/person; $80 + $12/person; $180 + $22/person per mo | per person | gusto.com/product/pricing |
| Homebase (staff) | $0 / $30 / $70 / $120 per location per mo | location | joinhomebase.com/pricing |
| Songtrust (splits/royalties) | $100 one-time + 15% / 20% commission | commission | songtrust.com/pricing |

Takeaway: music-specific tools run $15–$99/mo but are narrow, and Studio Hero starts at $205 for one seat. A one-location studio with 5 staff would pay about $309/mo for Sonido + Homebase Plus + Gusto Plus. Growth at $297 replaces that whole stack. Competitors like Square Premium charge per location ($149 each); Max's flat $699 with unlimited studios (Lawrence's decision) is a deliberate differentiator for multi-studio brands.

== CATEGORIES (use in metadata; list them in the PR summary for directory listings) ==
- App Store (the Pulse app): primary Business, secondary Productivity. This matches Acuity, Square Appointments and Vagaro Pro. Avoid Health & Fitness: fitness apps named "Studio Pulse" and "Pulse Studio" already sit there.
- G2: Studio Management; Online Appointment Scheduling. Request a new "Recording Studio Management" category.
- Capterra: Scheduling Software (Booking Management); suggest a new "Recording Studio Software" category.
- Product Hunt topics: Music, Productivity, SaaS, Business, Calendar, Artificial Intelligence, iOS.
- Site keywords: recording studio management software, music studio booking software, studio operating system, studio scheduling, session booking, studio staff scheduling and payroll, studio gear and patchbay management, split sheets, multi-studio management, white-label studio software, iOS studio app.
````
