/* Sales enablement content for /mypulse.
 *
 * Source of truth for WHAT is here: pulse-feature-catalog.html in the project
 * root, itself derived from the shipped codebase. The wording is not the
 * catalog's. The catalog is written for someone who already knows studios and
 * software; this page is written for someone who knows neither.
 *
 * House rules for every line below, because a rep reads them out loud:
 *  - short sentences, everyday words, one idea each
 *  - no metaphors, no shorthand, no "not X, it's Y"
 *  - name the thing that acts. Pulse does it, or the studio does, or the client
 *  - any term a stranger would not know gets explained in the same sentence
 *  - American spelling and American business vocabulary throughout
 *  - never claim more than the catalog claims. A rep repeating a line here is
 *    making a promise on the company's behalf
 *
 * Kept as a plain server module (no "use client") so the whole list only
 * crosses the wire once a visitor has cleared the password gate.
 *
 * Deliberately price-free. Plan names say what unlocks a feature and TIERS
 * below explains what each plan is for, but no figure appears anywhere, so
 * this page can never quote a number the pricing page stopped charging. */

export type Tier = "Studio" | "Pro" | "Label";

export type Feature = {
  name: string;
  /** One line a rep can say out loud to someone who knows nothing about studios. */
  desc: string;
  tier: Tier;
};

export type Section = {
  id: string;
  title: string;
  /** Why this group matters on a call, in the same plain voice. */
  note: string;
  items: Feature[];
};

/* What the three plans are for. No prices, on purpose: a rep needs to know
   which plan to put someone on, and that is a question about how the studio
   works, not about what it costs. */
export type TierGuide = { tier: Tier; who: string; gets: string; tell: string };

export const TIERS: TierGuide[] = [
  {
    tier: "Studio",
    who: "One or two rooms. The owner does most of the work. Anyone else who helps is paid per session rather than being on the payroll.",
    gets: "Everything needed to take a booking and get paid for it. The public booking page, money up front, charging for a client who does not show, the client list, bills and reminders, the today screen, finished mixes, and the rules that keep their records private.",
    tell: "If they answer their own phone and book their own sessions, this is their plan.",
  },
  {
    tier: "Pro",
    who: "A studio with people on the payroll, or more than two rooms.",
    gets: "Everything in Studio, plus the staff side and the thinking side. The staff schedule, clocking in and out, payroll, time off, the gear list, prepaid hours and memberships, what each room really earns, the assistant, and the links to Google Calendar and Gmail.",
    tell: "The moment they say the word employee, or name an engineer who draws a wage, they are Pro.",
  },
  {
    tier: "Label",
    who: "A record company, a production company, or anyone running several studios under one brand.",
    gets: "Everything in Pro, plus song ownership and the multi-studio layer. Split sheets with real signatures, release plans, selling the right to use a song, the cable map, software subscriptions, the whole app rebranded on their own web address, and one screen sitting above every studio they run.",
    tell: "If they own the songs as well as the rooms, or they run more than one studio, they are Label.",
  },
];

export const SECTIONS: Section[] = [
  {
    id: "bookings",
    title: "Booking and the calendar",
    note: "Show this part first. A client picks a room and a time on the studio's own web page and pays to hold it. Nobody has to answer the phone.",
    items: [
      { name: "Your own booking page", desc: "A web page with the studio's name, logo and colors on it. Clients pick a room and a time there, the way they would book a hotel room.", tier: "Studio" },
      { name: "No double bookings", desc: "Two people cannot book the same room at the same time. Pulse checks before it says yes.", tier: "Studio" },
      { name: "Money paid up front", desc: "The client pays part of the price to hold the time. That part is called the deposit, and it goes into the studio's own payment account.", tier: "Studio" },
      { name: "Extras at checkout", desc: "While booking, the client can also pay for an engineer, extra gear, or extra hours.", tier: "Studio" },
      { name: "Discount codes", desc: "The studio makes codes that take money off the price. The assistant can also suggest a discount code when a room is sitting empty.", tier: "Studio" },
      { name: "Reviews and credits on the page", desc: "The booking page can show what past clients said, plus the engineers' names and the records they worked on.", tier: "Studio" },
      { name: "See who sends you clients", desc: "When an artist sends a friend, Pulse remembers who sent them. The studio can see who brings in the most work.", tier: "Studio" },
      { name: "Instant text confirmation", desc: "The client gets a text right away saying the booking worked.", tier: "Studio" },
      { name: "Book a returning client in one tap", desc: "For someone who has been before, the studio taps once and the form is already filled in from last time.", tier: "Studio" },
      { name: "Waiting list", desc: "When someone cancels, Pulse offers those hours to people who asked to be told when time opens up.", tier: "Studio" },
      { name: "Deposit links for staff bookings", desc: "When staff book a session by hand, Pulse still texts the client a link to pay the deposit.", tier: "Studio" },
      { name: "The calendar", desc: "Every session in one place. Look at a whole month, one week, or just a list of today.", tier: "Studio" },
      { name: "Change a session while it runs", desc: "Add time, add gear, start a timer, write the engineer's notes, mark the client as arrived, or book the next session.", tier: "Studio" },
      { name: "Checklists before and after", desc: "A list of jobs to do before the client arrives and after they leave. Pulse writes the list when the session is booked.", tier: "Studio" },
      { name: "Google Calendar, both ways", desc: "Pulse and Google Calendar keep each other up to date. Block time in one and it blocks in the other.", tier: "Pro" },
      { name: "Other calendars mark hours busy", desc: "An outside calendar can gray out hours in Pulse without showing anyone what those hours are for.", tier: "Pro" },
    ],
  },
  {
    id: "money",
    title: "Money",
    note: "Pulse never holds the studio's money. Each studio connects its own account with Stripe, the company that moves card payments, and Stripe pays it out to their bank.",
    items: [
      { name: "Their own card-payment account", desc: "The studio connects its own Stripe account when it signs up. Client payments land in that account and Stripe pays them out to the studio's bank. Pulse only runs the checkout.", tier: "Studio" },
      { name: "Money paid and money owed", desc: "Pulse tracks what has been paid and what is still owed on every session, including part payments along the way.", tier: "Studio" },
      { name: "Saved card", desc: "With the client's permission, their card is kept on file so the studio can charge it later without asking again.", tier: "Studio" },
      { name: "Bills with a pay button", desc: "The studio sends a bill. The client taps the button in it and pays.", tier: "Studio" },
      { name: "Bills that write themselves", desc: "When a session ends with money still owed, Pulse writes the bill and sends it, minus what was already paid.", tier: "Studio" },
      { name: "Automatic payment reminders", desc: "If a bill goes unpaid, Pulse sends a reminder after 3 days, another after 7, and another after 14. Then it flags it for a person.", tier: "Studio" },
      { name: "Take the rest of the money in the room", desc: "Staff can collect the balance on the spot with a pay link, a code to scan with a phone camera, or a text.", tier: "Studio" },
      { name: "Every payment recorded", desc: "One list of every payment, sorted by what kind it was, including the ones staff type in by hand and any credit the studio gives back.", tier: "Studio" },
      { name: "Saved charges", desc: "Charges the studio adds all the time, saved once and dropped onto a bill in one click.", tier: "Studio" },
      { name: "Money Pulse won back", desc: "Pulse adds up the money the studio would have lost. It counts kept deposits, late fees, canceled hours it resold, and bills paid after a reminder, and it sends the total once a month.", tier: "Studio" },
      { name: "Sales tax", desc: "The studio picks its state and its tax rate. Pulse adds the tax at checkout.", tier: "Studio" },
      { name: "Prepaid blocks of hours", desc: "A client buys studio time in advance. Pulse holds it as credit and takes hours off it as they are used.", tier: "Pro" },
      { name: "Monthly memberships", desc: "Clients pay every month. They get a sign-up page and first pick of the calendar.", tier: "Pro" },
      { name: "What the studio spends", desc: "The studio types in its costs. Pulse takes them off what came in.", tier: "Pro" },
      { name: "What each room really made", desc: "What each room and each session cleared after costs, rather than what was charged.", tier: "Pro" },
      { name: "Your own price list", desc: "A company running several studios sets its own prices and resells Pulse to them.", tier: "Label" },
    ],
  },
  {
    id: "noshow",
    title: "People who do not turn up",
    note: "Start a cold call here. When a client misses a session, the studio usually gets nothing for that time. Pulse charges for it and tries to sell those hours to someone else.",
    items: [
      { name: "Cancellation rules", desc: "The studio decides how late is too late to cancel, and how much of the money it keeps when that happens.", tier: "Studio" },
      { name: "Keep the deposit", desc: "If a client cancels too late or never shows, the studio keeps what was paid. Pulse does it on its own, using the rules the studio set.", tier: "Studio" },
      { name: "Charge for a missed session", desc: "Pulse charges the card on file for the missed session, following those same rules.", tier: "Studio" },
      { name: "The awkward message, sent for you", desc: "Somebody has to tell the client they missed the session and are being charged. Pulse sends that message, written in the studio's own words.", tier: "Studio" },
      { name: "Refill the empty hours", desc: "The freed-up hours go out to the waiting list right away, so someone else can take them.", tier: "Studio" },
      { name: "Which bookings look shaky", desc: "Pulse points out the bookings that look likely to fall through, before they do.", tier: "Studio" },
      { name: "Warnings about money problems", desc: "Pulse reads the studio's records and warns the owner when it finds money being lost that nobody has noticed.", tier: "Pro" },
    ],
  },
  {
    id: "clients",
    title: "Clients",
    note: "One place for every client, everyone who has ever asked about a session, and everyone who worked on a song. Their whole history sits under their name.",
    items: [
      { name: "One list of everyone", desc: "Clients, artists, and people who have only asked about a session so far, all in one place.", tier: "Studio" },
      { name: "One person's whole history", desc: "Every message, session, bill and note about one person, in the order it happened.", tier: "Studio" },
      { name: "Your own tags", desc: "The studio adds its own tags and its own extra boxes, so the list is sorted the way that studio thinks.", tier: "Studio" },
      { name: "Bring your list in from a spreadsheet", desc: "Upload the client list the studio already keeps and it is in on day one.", tier: "Studio" },
      { name: "A private page for the client", desc: "The client taps a link in an email and lands on their own page. They can book again, pay a bill, and download finished songs.", tier: "Studio" },
      { name: "Guest passes", desc: "A link for someone helping on one job, like a bass player or an outside mixer. It shows them only their part and stops working after a set time.", tier: "Studio" },
      { name: "Ask for a review", desc: "A day after the session, Pulse asks the client what they thought. The studio can put those answers on the booking page.", tier: "Studio" },
      { name: "Turn a review into a referral", desc: "The same message carries a link the client can pass to a friend. Pulse tracks who sent who.", tier: "Studio" },
      { name: "Job board", desc: "A row of cards you move along as a job moves: asked about it, serious, quoted, booked, in the room, delivered, bought more.", tier: "Pro" },
      { name: "What each open job is worth", desc: "Pulse shows how much each job not yet won is worth, and how likely the client is to say yes.", tier: "Pro" },
    ],
  },
  {
    id: "staff",
    title: "Staff and shifts",
    note: "This is why a studio with employees moves up a plan. Putting an engineer on a session also puts them on the staff schedule, which is the grid of who works when. The same information is only entered once.",
    items: [
      { name: "The week's schedule", desc: "A grid of who works which day, in which room. Change it by typing straight on the grid.", tier: "Pro" },
      { name: "Booking an engineer makes their shift", desc: "Put an engineer on a session and their shift appears on the schedule by itself.", tier: "Pro" },
      { name: "Warning when someone is booked twice", desc: "If a person is needed in two places at once, Pulse warns you. It still lets you do it.", tier: "Pro" },
      { name: "Hours each person can work", desc: "Every member of staff sets the hours they are normally free.", tier: "Pro" },
      { name: "Time off requests", desc: "Staff ask for days off in the app. Managers get the request and say yes or no. Both sides get told.", tier: "Pro" },
      { name: "Who is on today", desc: "A strip across the home screen showing which staff are scheduled to work today.", tier: "Pro" },
      { name: "Clock in on a phone", desc: "Staff start and end their shift on their own phone. Pulse saves their pay rate at the moment they clock in, so a later raise cannot change old shifts.", tier: "Pro" },
      { name: "Payroll", desc: "Pulse multiplies each person's hours by their pay rate. It spreads salaries across the pay period and adds the engineer's share of each session. What it works out goes into the studio's costs.", tier: "Pro" },
      { name: "Pay periods", desc: "Pay people once a month, or every two weeks counting from a date the studio picks.", tier: "Pro" },
      { name: "New staff set themselves up", desc: "A new hire gets an invite with the studio's branding on it, reads what their job can do in the app, adds a photo and their hours. Then they are working.", tier: "Pro" },
      { name: "Alerts for each person", desc: "Each person is only alerted about the things that are their job.", tier: "Pro" },
    ],
  },
  {
    id: "floor",
    title: "The front desk",
    note: "What the studio keeps open on a screen from the morning until the last session ends.",
    items: [
      { name: "The today screen", desc: "One screen shows today. It lists every session in order and who is in which room. It also shows who has arrived, who still owes money, who is working, and what tomorrow looks like.", tier: "Studio" },
      { name: "Get ready for the next client", desc: "A shared list of what to set up before the next person walks in. Check something off and every staff screen updates at once.", tier: "Studio" },
      { name: "Is the room free", desc: "Free or busy, and busy until what time. Worked out from the real bookings, so nobody has to work it out.", tier: "Studio" },
      { name: "Notes on how the session was set up", desc: "The engineer writes down which gear they used, what it was plugged into, and the speed and key of the song. Pulse saves it against the session.", tier: "Studio" },
      { name: "It installs on a phone", desc: "Pulse can sit on a phone home screen with its own row of buttons along the bottom. It does not have to come from an app store.", tier: "Studio" },
      { name: "Phone alerts", desc: "Staff phones buzz for the things that cannot wait for an email.", tier: "Studio" },
      { name: "Sign-in screen at the door", desc: "A sign-in page and a code to scan by the front door. Guests sign themselves in, so the studio knows who is in the building.", tier: "Pro" },
      { name: "A printable sign with your code", desc: "A sign carrying the studio's own scan code, ready to print and put in a frame.", tier: "Pro" },
      { name: "A named parking badge", desc: "A badge with the client's name for their parking space. A small thing, and clients remember it.", tier: "Pro" },
    ],
  },
  {
    id: "gear",
    title: "Rooms, gear and cables",
    note: "The part ordinary business software does not have. What gear is in the room, what it is worth, and what it is plugged into.",
    items: [
      { name: "Rooms", desc: "Each room with photos, an hourly price, how much deposit it needs, and prices for different kinds of work.", tier: "Studio" },
      { name: "A list of every piece of gear", desc: "Everything the studio owns, with photos taken on a phone or picked from a library.", tier: "Pro" },
      { name: "What needs servicing", desc: "What is due for a repair or a service, and what has already been done.", tier: "Pro" },
      { name: "Renting gear out", desc: "Gear lent to other people, tracked and billed like any other charge.", tier: "Pro" },
      { name: "Bring the gear list in from a spreadsheet", desc: "Upload the gear spreadsheet the studio already keeps.", tier: "Pro" },
      { name: "Software subscriptions", desc: "Every piece of software the studio pays for, with what each one costs to renew.", tier: "Label" },
      { name: "A map of the cables", desc: "Which box is plugged into which socket, written down where the whole team can see it.", tier: "Label" },
      { name: "Fill in a piece of gear once", desc: "Describe a model once. Every copy of it in the building uses those same details.", tier: "Label" },
      { name: "Look up what a socket does", desc: "Check what a socket on a piece of gear is, without looking it up in the manual.", tier: "Label" },
      { name: "Set up sockets from the maker's sheet", desc: "Upload the maker's specification sheet. Pulse reads it and fills in every input and output on that piece of gear.", tier: "Label" },
      { name: "Notes and history on the cable map", desc: "Notes and groups on the map, plus a record of who moved which cable and when.", tier: "Label" },
    ],
  },
  {
    id: "catalog",
    title: "Songs",
    note: "Studios sell hours, and those hours produce songs. Pulse tracks the songs as well as the appointments.",
    items: [
      { name: "Finished mixes", desc: "Every version of a mix, saved in order and numbered. The client listens, approves and downloads them here instead of over email.", tier: "Studio" },
      { name: "Notes on one version of a mix", desc: "Feedback attached to the exact version it is about, so it stops getting lost in text messages.", tier: "Studio" },
      { name: "Every song in one place", desc: "Each song with its artwork, how far along it is, and which sessions made it.", tier: "Pro" },
      { name: "Paste a streaming link", desc: "Paste a link to the song on a streaming service and Pulse fills in the artwork and the details.", tier: "Pro" },
      { name: "Who owns what share of a song", desc: "The percentage each writer and producer owns, agreed and written down in one form.", tier: "Label" },
      { name: "Real signatures by link", desc: "Everyone on the song signs the form by clicking a link. It counts as a real signature.", tier: "Label" },
      { name: "The form fills itself in", desc: "The people already listed on the song are already on the ownership form.", tier: "Label" },
      { name: "A plan for putting a song out", desc: "A list of jobs and dates for a release, tracked from planning until the song is out.", tier: "Label" },
      { name: "Selling the right to use a song", desc: "The studio can sell permission to use a song in a film, on television, in an ad or in a game. It can also sell a beat, at levels running from a cheap audio file up to an exclusive license.", tier: "Label" },
      { name: "Print who owns what", desc: "Download the full ownership picture for when a publisher asks for it.", tier: "Label" },
    ],
  },
  {
    id: "ai",
    title: "The assistant",
    note: "An assistant that reads the studio's own records, suggests what to do next, and waits for a person to say yes before it does anything.",
    items: [
      { name: "It does not take orders from a client message", desc: "If a client writes instructions into a message, the assistant treats them as words to read. It can only ever see one studio's records.", tier: "Studio" },
      { name: "Pulse Agent", desc: "An assistant you type at in plain English. It answers from that studio's own records.", tier: "Pro" },
      { name: "It always asks first", desc: "Nothing that reaches a client and nothing involving money happens until a person taps approve.", tier: "Pro" },
      { name: "Daily summary", desc: "A short note on what happened and what needs attention, sent at whatever hour the studio picks.", tier: "Pro" },
      { name: "Studio health score", desc: "One score for how the business is doing. It is built from six fixed things, so the number means the same today as it did last week.", tier: "Pro" },
      { name: "It remembers", desc: "Tell it something once and it still knows later.", tier: "Pro" },
      { name: "A record of what it did", desc: "Every action the assistant took, written down and never edited, plus how much of the plan's allowance it has used.", tier: "Pro" },
      { name: "It answers booking texts day and night", desc: "Someone texts asking about a session at any hour and it replies with the booking link. It never promises a time it cannot actually hold.", tier: "Pro" },
      { name: "The scheduled check (Ops Autopilot)", desc: "It looks over the studio on a schedule and puts together a list of things worth doing.", tier: "Pro" },
      { name: "The connection map (Studio Brain)", desc: "A map of how everything connects: which artist made which song, in which room, with which gear and which engineer.", tier: "Pro" },
      { name: "Guesses from your own history", desc: "Forecasts built from this studio's own history.", tier: "Pro" },
      { name: "A short list of what matters", desc: "The things worth knowing today, most important first, each one showing why it thinks so.", tier: "Pro" },
      { name: "It writes, you send", desc: "It drafts the email, the session summary or the offer. A person reads it and presses send.", tier: "Pro" },
      { name: "Let simple reminders run themselves", desc: "The owner can switch on plain reminders so they go out with no approval. Everything else still waits for approval.", tier: "Label" },
      { name: "Ask it the same thing every week", desc: "Save a question and have the assistant answer it every day or every week without being asked.", tier: "Label" },
      { name: "All the assistants on one screen", desc: "For a company with many studios: every assistant, how each studio is doing, and everything waiting for approval, in one place.", tier: "Label" },
    ],
  },
  {
    id: "comms",
    title: "Talking to clients",
    note: "Emails to clients can go out from Pulse, or from the studio's own Gmail. The studio picks which.",
    items: [
      { name: "Email that works on day one", desc: "Pulse sends the studio's client emails from the first minute, and the studio does not have to set anything up first.", tier: "Studio" },
      { name: "Text messages", desc: "Texting, with the phone company paperwork already done, so the messages actually arrive instead of being blocked.", tier: "Studio" },
      { name: "STOP means stop", desc: "If someone replies STOP, they stop getting texts for good, and Pulse writes that down.", tier: "Studio" },
      { name: "Reminders before the session", desc: "2 days before, 1 day before, and 2 hours before. Reminders cut missed sessions more than any other setting in the app.", tier: "Studio" },
      { name: "The conversation stays with the client", desc: "Messages are saved under the client's name in the app, where any member of staff can open them.", tier: "Studio" },
      { name: "Telling the right staff", desc: "When something happens, Pulse tells the people who need to know.", tier: "Studio" },
      { name: "Send from your own Gmail", desc: "Connect Google and client emails go out from the studio's real address.", tier: "Pro" },
      { name: "One inbox", desc: "Conversations and things waiting for approval in one place instead of five.", tier: "Pro" },
    ],
  },
  {
    id: "reporting",
    title: "Numbers",
    note: "Most studio owners cannot tell you which of their rooms makes money. These screens answer that.",
    items: [
      { name: "How much money came in", desc: "The month's total, whether it is going up or down, and where it came from.", tier: "Pro" },
      { name: "The numbers that matter", desc: "Pulse tracks four things: how fast the studio replies to a new inquiry, how many inquiries turn into bookings, how many clients miss sessions, and how many bills are late.", tier: "Pro" },
      { name: "Arrange the home screen", desc: "The owner drags the boxes around so the first screen matches the way they work.", tier: "Pro" },
      { name: "Charts", desc: "Money over time, and how the open jobs are spread across the stages.", tier: "Pro" },
      { name: "What the booking page earned", desc: "How much money the public booking page brought in, and how many of those clients were new.", tier: "Pro" },
      { name: "How much of the plan is used", desc: "How much assistant use, storage, texting and email the studio has used against what the plan includes.", tier: "Pro" },
      { name: "Download your numbers", desc: "The studio can pull its own figures out whenever it wants them.", tier: "Pro" },
    ],
  },
  {
    id: "brand",
    title: "Making it look like theirs",
    note: "Upload a logo and the app changes to the studio's colors. On the top plan the whole thing looks like software they built.",
    items: [
      { name: "Colors from your logo", desc: "Upload the logo. Pulse pulls the colors out of it and repaints the app while you watch.", tier: "Studio" },
      { name: "A photo at the top of the booking page", desc: "Upload one, or have Pulse make one that looks like the studio's own photography.", tier: "Studio" },
      { name: "The words on the booking page", desc: "The headline, the welcome text and the deposit rules, written in the studio's own voice.", tier: "Studio" },
      { name: "One brand color everywhere", desc: "The studio's color used across everything a client sees.", tier: "Studio" },
      { name: "Their brand inside the app", desc: "Their logo and their color in the app their own team uses all day.", tier: "Pro" },
      { name: "The app looks like theirs", desc: "Their colors, their fonts, how round the corners are, and how much space sits between things.", tier: "Label" },
      { name: "Their own login screen", desc: "The first screen anyone sees carries their headline, their words and their picture.", tier: "Label" },
      { name: "Emails in their colors", desc: "Automatic emails go out in their colors and sign off in their words.", tier: "Label" },
      { name: "Their own web address", desc: "The whole app sits at the studio's own address instead of ours.", tier: "Label" },
      { name: "Colors stay readable", desc: "Pulse checks the colors they pick still have enough contrast to read, so nobody ends up with an app they cannot see.", tier: "Label" },
      { name: "A small Pulse mark", desc: "A small Pulse name and symbol sits under their logo. It comes with the plan and cannot be removed.", tier: "Label" },
    ],
  },
  {
    id: "agency",
    title: "Running many studios",
    note: "One screen sitting above a group of studios. Each studio only ever sees its own work.",
    items: [
      { name: "One screen for every studio", desc: "All the studios, how each one is doing and what each one earned, in one view.", tier: "Label" },
      { name: "Invite a studio by email", desc: "Send an email. They get a sign-up with your branding on it and can take bookings the same day.", tier: "Label" },
      { name: "Step-by-step setup", desc: "Logo, business details, booking words, payments, email, first room. They can stop halfway and finish later.", tier: "Label" },
      { name: "Pull details off their website", desc: "Take a new studio's details straight from the website they already have, instead of typing them in.", tier: "Label" },
      { name: "Switch parts off per studio", desc: "Turn a whole section of the app off for one studio without touching any of the others.", tier: "Label" },
      { name: "Your own price list", desc: "The plans you resell to your studios, with free trials, offers, and different terms for one account if you want.", tier: "Label" },
      { name: "Staff who see only their studios", desc: "Team members are given a few studios and cannot open the rest.", tier: "Label" },
      { name: "The console under your brand", desc: "Your screen and all its studios under your own name and your own web address.", tier: "Label" },
      { name: "One approval queue for all studios", desc: "Everything waiting on a person, across every studio, lined up in one list.", tier: "Label" },
      { name: "Who did what, where", desc: "A record of every action, which studio it happened in, and when.", tier: "Label" },
      { name: "Fake data for a pitch", desc: "Fill an empty studio with realistic made-up bookings and money for a demo, then wipe it clean.", tier: "Label" },
    ],
  },
  {
    id: "platform",
    title: "Safety and privacy",
    note: "One studio can never see another studio's records. Pulse blocks it in the code that reads the database, so hiding a button is not what is protecting them.",
    items: [
      { name: "Studios cannot see each other", desc: "Every question the app asks the database is locked to one studio. Files only open for the studio that owns them.", tier: "Studio" },
      { name: "One place that checks permissions", desc: "Every part of the app asks the same piece of code whether this person is allowed. Because there is only one place to check, there is only one place to get right.", tier: "Studio" },
      { name: "Roles", desc: "Owner, manager, engineer, staff and guest. Each role opens only its own part of the app.", tier: "Studio" },
      { name: "You get what you paid for", desc: "The plan is checked in the code itself, so a locked feature stays locked even if someone finds its address.", tier: "Studio" },
      { name: "A permanent record", desc: "Pulse writes down every refund, approval, invite and signature. It can add new entries, and nobody can change or delete an old one.", tier: "Studio" },
      { name: "Clients can get or delete their data", desc: "A client can ask for a copy of everything held about them, or ask for it to be deleted. The law says the studio has to do both, so Pulse builds both in.", tier: "Studio" },
      { name: "Guest links that expire", desc: "A guest link opens one thing only, stops working after a set time, and can be switched off early.", tier: "Studio" },
      { name: "Allowances counted per plan", desc: "Pulse counts how much the assistant, the file storage and any extra allowance are used, and caps them at what the plan includes.", tier: "Studio" },
      { name: "Use it before setup is finished", desc: "The studio can start working the moment they sign up and finish setting up later. The first booking does not have to wait for it.", tier: "Studio" },
      { name: "We move your data for free", desc: "Pulse copies the studio's existing information across for them at no charge, and they are running in a day. Rival software often takes months to set up.", tier: "Studio" },
      { name: "No contract", desc: "Cancel any month. There is no year-long agreement, and nothing extra to buy for the things other companies charge for on the side.", tier: "Studio" },
      { name: "955 automatic checks", desc: "955 tests run on their own over the money, the rule that keeps one studio's records away from another, and what each plan includes.", tier: "Studio" },
    ],
  },
];

export const TOTAL_FEATURES = SECTIONS.reduce((n, s) => n + s.items.length, 0);

/* Not built. Here so a rep can answer "do you do X?" honestly and still sound
   like they know where the product is going. Never pitch as live. */
export type Roadmap = { kind: string; title: string; what: string; why: string };

export const ROADMAP: Roadmap[] = [
  {
    kind: "Big bet",
    title: "A public list of studios on Pulse",
    what: "A free page anyone can search, showing every studio using Pulse and the hours they actually have free. Artists find a studio and book it there and then.",
    why: "Today Pulse is a cost to the studio. This would make it bring work in, which is the thing every owner says they need.",
  },
  {
    kind: "Big bet",
    title: "Paying the engineer automatically",
    what: "When a session ends, Pulse works out the engineer's share and lines up the payment. It uses the clock-in times and the song ownership forms it already holds.",
    why: "No competitor does this, and a studio that comes to rely on it is unlikely to move.",
  },
  {
    kind: "Big bet",
    title: "A cheaper plan paid for by payments",
    what: "A lower monthly plan for studios that run their card payments through Pulse, where Pulse takes a small slice of each payment instead. Later, paying studios out the same day, and lending against future bookings.",
    why: "Studios stop saying it is too expensive. What Pulse earns rises only when the studio earns more.",
  },
  {
    kind: "Big bet",
    title: "A yearly report on the studio business",
    what: "Pulse would publish real numbers from all its studios with every name removed. The report would show what studios charge, how full their rooms are, and how often clients miss sessions, split by city and by room type.",
    why: "Owners have no idea what everyone else charges, and these numbers are not published anywhere.",
  },
  {
    kind: "Sales and marketing",
    title: "A page comparing us to the main rival",
    what: "A plain, factual comparison. With Pulse the studio pays monthly, where the rival asks them to sign for a year. The calendar link and the extra staff logins are included, where the rival charges for both.",
    why: "Studios switch the morning after they lose money, and this is the page they would find that morning.",
  },
  {
    kind: "Sales and marketing",
    title: "The moving promise, in writing",
    what: "A promise printed where the prices are: we move your data for free and you are running within a day.",
    why: "Studios say the reason they stay put is that moving sounds painful. It costs us little to promise and it is hard for a rival to match.",
  },
  {
    kind: "Nearly done",
    title: "Typing the card number into the page",
    what: "Saving a card and charging it later both work now. The box where the client types their card number is the last piece.",
    why: "Charging for a missed session already works, it just takes an extra step. This makes it one step.",
  },
  {
    kind: "Nearly done",
    title: "Counting visits to the booking page",
    what: "Recording how many people open the booking page, so the studio can see how many looked, how many booked and how many paid.",
    why: "Pulse already knows what the page earned. Without visit counts it cannot say how many visitors it took to earn it.",
  },
  {
    kind: "Nearly done",
    title: "Turning a suggestion into a standing rule",
    what: "Take something the assistant suggests and make it a permanent rule in one click, instead of approving the same thing every week.",
    why: "The studio would only have to make each decision once.",
  },
];
