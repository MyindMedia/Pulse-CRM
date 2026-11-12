import {
  FEATURE_GROUPS,
  NOT_BUILT_YET,
  PRICING,
  PULSE_APP_CAPABILITIES,
  TIERS,
  TIER_ACCESS,
  tierTotals,
  type FeatureGroup,
  type TierKey,
} from "@convex/lib/pricing";

/* Sales enablement content for /mypulse.
 *
 * WHAT is on the sheet, and which plan each row sits on, comes from
 * convex/lib/pricing.ts (FEATURE_GROUPS, PRICING, TIER_ACCESS,
 * PULSE_APP_CAPABILITIES, NOT_BUILT_YET). This file only holds the words a
 * rep reads out: one plain description per feature, joined on the exact
 * feature name. A feature whose `built` flag is false is not on the sheet;
 * when another part of the build flips it to true it appears here on its own.
 *
 * House rules for every line below, because a rep reads them out loud:
 *  - short sentences, everyday words, one idea each
 *  - no metaphors, no shorthand, no "not X, it's Y"
 *  - name the thing that acts. Pulse does it, or the studio does, or the client
 *  - any term a stranger would not know gets explained in the same sentence
 *  - American spelling and American business vocabulary throughout
 *  - never claim more than the product does. A rep repeating a line here is
 *    making a promise on the company's behalf
 *
 * Kept as a plain server module (no "use client") so the whole list only
 * crosses the wire once a visitor has cleared the password gate. */

export type Tier = TierKey;

export type Feature = {
  name: string;
  /** One line a rep can say out loud to someone who knows nothing about studios. */
  desc: string;
  tier: TierKey;
  /** Moved to a cheaper plan in the Core / Growth / Max repack. */
  moved?: boolean;
};

export type Section = {
  id: string;
  title: string;
  /** Why this group matters on a call, in the same plain voice. */
  note: string;
  isNew?: boolean;
  items: Feature[];
};

/* What each plan is for, read from the pricing config. */
export type TierGuide = {
  tier: TierKey;
  name: string;
  who: string;
  gets: string;
  tell: string;
  access: readonly string[];
  app: readonly string[];
};

export const TIERS_GUIDE: TierGuide[] = TIERS.map((t) => ({
  tier: t,
  name: PRICING[t].name,
  who: PRICING[t].who,
  gets: PRICING[t].gets,
  tell: PRICING[t].salesTell,
  access: TIER_ACCESS[t],
  app: PULSE_APP_CAPABILITIES[t],
}));

/** Display name for a tier key ("Core"). */
export const tierName = (t: TierKey): string => PRICING[t].name;

/* One line per feature, by exact name. */
const DESC: Record<string, string> = {
  "Your own booking page":
    "A web page with the studio's name, logo and colors on it. Clients pick a room and a time there, the way they would book a hotel room.",
  "No double bookings":
    "Two people cannot book the same room at the same time. Pulse checks before it says yes.",
  "Money paid up front":
    "The client pays part of the price to hold the time. That part is called the deposit, and it goes into the studio's own payment account.",
  "Extras at checkout":
    "While booking, the client can add rented gear and the extras the studio offers, and request an engineer.",
  "Discount codes":
    "The studio makes codes that take money off the price. The assistant can also suggest a discount code when a room is sitting empty.",
  "Reviews and credits on the page":
    "The booking page can show what past clients said, plus the engineers' names and the records they worked on.",
  "See who sends you clients":
    "When a booking comes in through a link with a client's referral code, Pulse records who sent it.",
  "Instant text confirmation":
    "The client gets a text right after they book, with the link to pay the deposit and lock it in.",
  "Book a returning client in one tap":
    "For someone who has been before, the studio taps once and the form is already filled in from last time.",
  "Waiting list":
    "When someone cancels, Pulse offers those hours to people who asked to be told when time opens up.",
  "Deposit links for staff bookings":
    "When staff book a session by hand, Pulse emails the client a link to pay the deposit, and staff can text a pay link in one tap.",
  "The calendar":
    "Every session in one place. Look at a whole month, one week, or just a list of today.",
  "Change a session while it runs":
    "Add time, add gear, start a timer, write the engineer's notes, start the session, or book the next session.",
  "Checklists before and after":
    "A list of jobs to do before the client arrives and after they leave. Pulse writes the list when the session is booked.",
  "Google Calendar, both ways":
    "Pulse and Google Calendar keep each other up to date. Block time in one and it blocks in the other.",
  "Other calendars mark hours busy":
    "Busy hours from an outside calendar show on the room page, without showing what they are for. They do not block bookings yet.",
  "Their own card-payment account":
    "The studio connects its own Stripe account when it signs up. Client payments land in that account and Stripe pays them out to the studio's bank. Pulse only runs the checkout.",
  "Money paid and money owed":
    "Pulse tracks what has been paid and what is still owed on every session, including part payments along the way.",
  "Saved card":
    "Not ready yet. Pulse cannot charge a saved card today. Fees for a missed session go out as a bill.",
  "Bills with a pay button":
    "The studio sends a bill. The client taps the button in it and pays.",
  "Bills that write themselves":
    "When a session ends with money still owed, Pulse drafts the bill, minus what was already paid. The studio checks it and sends it in one tap.",
  "Automatic payment reminders":
    "If a bill goes unpaid, Pulse sends a reminder after 3 days, another after 7, and another after 14. Then it flags it for a person.",
  "Take the rest of the money in the room":
    "Staff can collect the balance on the spot with a pay link, a code to scan with a phone camera, or a text.",
  "Every payment recorded":
    "One list of every payment, sorted by what kind it was, including the ones staff type in by hand and any credit the studio gives back.",
  "Saved charges":
    "Charges the studio adds all the time, saved once and dropped onto a bill in one click.",
  "Money Pulse won back":
    "Pulse adds up the money the studio would have lost. It counts kept deposits, late fees once they are paid, and bills paid after a reminder, and it sends the total once a month.",
  "Sales tax":
    "The studio saves its state and its tax rate. Pulse does not add tax to bills or checkout yet.",
  "Prepaid blocks of hours":
    "The studio sets up prepaid blocks of hours and draws hours down from a client's credit.",
  "Monthly memberships":
    "Clients pay every month. They sign up on the studio's own page.",
  "What the studio spends":
    "The studio types in its costs. Pulse takes them off what came in.",
  "Profit score and profit after costs":
    "Pulse grades the studio against healthy studio numbers and shows what is left after the costs the studio enters, rather than what was charged.",
  "Your own price list":
    "A company running several studios sets its own prices and resells Pulse to them.",
  "Cancellation rules":
    "The studio decides how late is too late to cancel, and how much of the money it keeps when that happens.",
  "Keep the deposit":
    "When staff mark a late cancel or a no-show, the studio keeps the deposit. Pulse follows the rules the studio set.",
  "Bill for a missed session":
    "When staff mark a no-show, Pulse keeps the deposit and drafts a bill for the fee at the percentage the studio set. Staff check it and send it.",
  "The awkward message, sent for you":
    "Somebody has to tell the client they missed the session and that a fee applies. Pulse sends a short, polite notice for the studio.",
  "Refill the empty hours":
    "When a client cancels, Pulse texts the open hours to the waiting list, so someone else can take them.",
  "Which bookings look shaky":
    "Pulse points out the bookings that look likely to fall through, before they do.",
  "Warnings about money problems":
    "Pulse reads the studio's records and warns the owner when it finds money being lost that nobody has noticed.",
  "One list of everyone":
    "Clients, artists, and people who have only asked about a session so far, all in one place.",
  "One person's whole history":
    "One person's sessions, bills, messages and notes, all under their name.",
  "Your own tags":
    "The studio adds its own tags, so the list is sorted the way that studio thinks.",
  "Bring your list in from a spreadsheet":
    "Upload the client list the studio already keeps and it is in on day one.",
  "A private page for the client":
    "The client taps a link in an email and lands on their own page. They can book again, pay a bill, and download finished songs.",
  "Guest passes":
    "A link for someone helping on one job, like a bass player or an outside mixer. It shows them only their part and stops working after a set time.",
  "Ask for a review":
    "A day after the session, Pulse asks the client what they thought. The studio can put those answers on the booking page.",
  "Turn a review into a referral":
    "Not ready yet. The review message does not carry a referral link today.",
  "Job board":
    "A row of cards you move along as a job moves: asked about it, serious, quoted, booked, in the room, delivered, bought more.",
  "What each open job is worth":
    "Pulse shows how much each job not yet won is worth, and how likely the client is to say yes.",
  "The week's schedule":
    "A grid of who works which day, in which room. Click a day to add a shift, or a shift to change it.",
  "Booking an engineer makes their shift":
    "Put an engineer on a session and their shift appears on the schedule by itself.",
  "Warning when someone is booked twice":
    "If a person is needed in two places at once, Pulse warns you. It still lets you do it.",
  "Hours each person can work":
    "Every member of staff sets the hours they are normally free.",
  "Time off requests":
    "Staff ask for days off in the app. Managers get the request and say yes or no. Both sides get told.",
  "Who is on today":
    "A strip across the home screen showing which staff are scheduled to work today.",
  "Clock in on a phone":
    "Staff start and end their shift on their own phone. Pulse saves their pay rate at the moment they clock in, so a later raise cannot change old shifts.",
  "Payroll":
    "Pulse multiplies each person's hours by their pay rate. It spreads salaries across the pay period. If the studio turns it on, it also queues each engineer's share of a session for approval. What it works out goes into the studio's costs.",
  "Pay periods":
    "Pay people once a month, or every two weeks counting from a date the studio picks.",
  "New staff set themselves up":
    "A new hire gets an invite from the studio, reads what their job can do in the app, adds a photo and their hours. Then they are working.",
  "Alerts for each person":
    "Each person is only alerted about the things that are their job.",
  "The today screen":
    "One screen shows today. It lists every session in order and who is in which room. It also shows who has arrived, who still owes money, who is working, and what tomorrow looks like.",
  "Get ready for the next client":
    "A shared list of what to set up before the next person walks in. Check something off and every staff screen updates at once.",
  "Is the room free":
    "Free or busy, and busy until what time. Worked out from the real bookings, so nobody has to work it out.",
  "Notes on how the session was set up":
    "The engineer writes down the session format, monitoring, tempo and notes. Pulse saves it against the session.",
  "It installs on a phone":
    "Pulse can sit on a phone home screen with its own row of buttons along the bottom. It does not have to come from an app store.",
  "Phone alerts":
    "Staff phones buzz for the things that cannot wait for an email.",
  "Sign-in screen at the door":
    "A sign-in page and a code to scan by the front door. Guests sign themselves in, so the studio knows who is in the building.",
  "A printable sign with your code":
    "A sign carrying the studio's own scan code, ready to print and put in a frame.",
  "A named parking badge":
    "A badge with the client's name for their parking space. A small thing, and clients remember it.",
  "Rooms":
    "Each room with photos, an hourly price, how much deposit it needs, and prices for different kinds of work.",
  "A list of every piece of gear":
    "Everything the studio owns, with photos taken on a phone or picked from a library.",
  "What needs servicing":
    "Mark gear as in for repair and see how many pieces are out.",
  "Renting gear out":
    "Gear offered as a paid add-on on bookings. The price is added to the session bill.",
  "Bring the gear list in from a spreadsheet":
    "Upload the gear spreadsheet the studio already keeps.",
  "Software subscriptions":
    "Every piece of software the studio pays for, with what each one costs to renew.",
  "A map of the cables":
    "Which box is plugged into which socket, written down where the whole team can see it.",
  "Fill in a piece of gear once":
    "Describe a model once. Every copy of it in the building uses those same details.",
  "Look up what a socket does":
    "Check what a socket on a piece of gear is, without looking it up in the manual.",
  "Set up sockets from the maker's sheet":
    "Upload the maker's specification sheet. Pulse reads it and proposes every input and output for the studio to approve.",
  "Notes and history on the cable map":
    "Notes and groups on the map, plus a record of who moved which cable and when.",
  "Finished mixes":
    "Every version of a mix, saved in order and numbered. The studio marks the one the client signs off on, and the client downloads approved versions from their client page.",
  "Notes on one version of a mix":
    "Feedback attached to the exact version it is about, so it stops getting lost in text messages.",
  "Every song in one place":
    "Each song with its artwork, how far along it is, and which sessions made it.",
  "Paste a streaming link":
    "Paste a link to the song on a streaming service and Pulse fills in the artwork and the details.",
  "Pull in your whole catalog with credits":
    "Pick your roles, paste your artist link or type your name, and every song you are credited on lands in Songs with its credits and a drafted split sheet.",
  "Who owns what share of a song":
    "The percentage each writer and producer owns, agreed and written down in one form.",
  "Real signatures by link":
    "Pulse makes a one-use signing link for each person. The studio sends it to them, and they sign from their phone.",
  "The form fills itself in":
    "Paste a streaming link and the ownership form starts with the song's published writers and producers.",
  "A plan for putting a song out":
    "A list of jobs and dates for a release, tracked from planning until the song is out.",
  "Selling the right to use a song":
    "Track sync pitches from first send to placement, and keep a record of every beat license sold, with the tier, price and buyer. An exclusive sale retires the beat's other licenses.",
  "Print who owns what":
    "Download the full ownership picture for when a publisher asks for it.",
  "It does not take orders from a client message":
    "If a client writes instructions into a message, the assistant treats them as words to read. It can only ever see one studio's records.",
  "Pulse Agent":
    "An assistant you type at in plain English. It answers from that studio's own records.",
  "It always asks first":
    "By default nothing reaches a client or touches money until a person approves it. The receptionist and Max auto-reminders only run if the studio switches them on.",
  "Daily summary":
    "A short note on what happened and what needs attention, sent at whatever hour the studio picks.",
  "Studio health score":
    "One score for how the business is doing. It is built from six fixed things, so the number means the same today as it did last week.",
  "It remembers":
    "Tell it something once and it still knows later.",
  "A record of what it did":
    "Every action the assistant takes is written to a log that cannot be edited.",
  "It answers booking texts day and night":
    "An existing client texts asking about a session at any hour and it replies with the booking link. It never promises a time it cannot actually hold.",
  "The scheduled check (Ops Autopilot)":
    "It looks over the studio on a schedule and puts together a list of things worth doing.",
  "The connection map (Studio Brain)":
    "The assistant knows which artist, room, gear and engineer go with each song.",
  "Guesses from your own history":
    "Forecasts built from this studio's own history.",
  "A short list of what matters":
    "The things worth knowing today, most important first, each one showing why it thinks so.",
  "It writes, you send":
    "It drafts the email, the session summary or the offer. A person reads it and presses send.",
  "Let simple reminders run themselves":
    "The owner can switch on plain reminders so they go out with no approval. Everything else still waits for approval.",
  "Ask it the same thing every week":
    "Save a question and have the assistant answer it every day or every week without being asked.",
  "All the assistants on one screen":
    "For a company with many studios: every assistant, how each studio is doing, and everything waiting for approval, in one place.",
  "Email that works on day one":
    "Pulse sends the studio's client emails from the first minute, and the studio does not have to set anything up first.",
  "Text messages":
    "Texting, with the phone company paperwork already done, so the messages arrive instead of being blocked.",
  "STOP means stop":
    "If someone replies STOP, they stop getting texts for good, and Pulse writes that down.",
  "Reminders before the session":
    "About a day before and again about two hours before the session, so clients remember to show up.",
  "The conversation stays with the client":
    "Texts, portal messages and emails the team sends are saved under the client's name.",
  "Telling the right staff":
    "When something happens, Pulse tells the people who need to know.",
  "Send from your own Gmail":
    "Connect Google and the emails staff write to clients go out from the studio's real address. Automatic reminders and receipts still come from Pulse.",
  "One inbox":
    "Drafts from the scheduled checks wait here for a person to approve. Client conversations are one tap away under Messages.",
  "How much money came in":
    "The month's total, whether it is going up or down, and where it came from.",
  "The numbers that matter":
    "Pulse tracks three things: late bills, how many inquiries book, and how many clients miss sessions.",
  "Arrange the home screen":
    "The owner drags the boxes around so the first screen matches the way they work.",
  "Charts":
    "Money over time, and how the open jobs are spread across the stages.",
  "What the booking page earned":
    "How much the public booking page booked, and where those visitors came from.",
  "How much of the plan is used":
    "How much assistant use, storage, texting and email the studio has used against what the plan includes.",
  "Download your numbers":
    "The studio can pull its own figures out whenever it wants them.",
  "Colors from your logo":
    "Upload the logo. Pulse pulls the colors out of it and repaints the app while you watch.",
  "A photo at the top of the booking page":
    "Upload one, or have Pulse make one that looks like the studio's own photography.",
  "The words on the booking page":
    "The headline, the welcome text and the deposit rules, written in the studio's own voice.",
  "One brand color everywhere":
    "The studio's color used across everything a client sees.",
  "Their brand inside the app":
    "Their logo and their color in the app their own team uses all day.",
  "The app looks like theirs":
    "Their colors, their fonts, how round the corners are, and how much space sits between things.",
  "Their own login screen":
    "Anyone who opens Pulse with the studio's sign-in link sees their headline, their words and their picture.",
  "Emails in their colors":
    "Automatic emails go out in their colors and sign off in their words.",
  "Their own web address":
    "The whole app sits at the studio's own address instead of ours.",
  "Colors stay readable":
    "Pulse checks the colors they pick still have enough contrast to read, so nobody ends up with an app they cannot see.",
  "A small Pulse mark":
    "A small Pulse name and symbol sits under their logo. It comes with the plan and cannot be removed.",
  "One screen for every studio":
    "All the studios, how each one is doing and what each one earned, in one view.",
  "Invite a studio by email":
    "Send an email. They get a sign-up with your branding on it and can take bookings the same day.",
  "Step-by-step setup":
    "Logo, business details, booking words, payments, email, first room. They can stop halfway and finish later.",
  "Switch off parts of the app you do not use":
    "Turn off sections of the app the studio does not use, so they leave the menu. Core parts stay on.",
  "Pull details off their website":
    "Take a new studio's details straight from the website they already have, instead of typing them in.",
  "Switch parts off per studio":
    "Turn a whole section of the app off for one studio without touching any of the others.",
  "Staff who see only their studios":
    "Team members are given a few studios and cannot open the rest.",
  "The console under your brand":
    "Your screen and all its studios under your own name and your own web address.",
  "One approval queue for all studios":
    "Everything waiting on a person, across every studio, lined up in one list.",
  "Who did what, where":
    "A record of every action, which studio it happened in, and when.",
  "Fake data for a pitch":
    "Fill an empty studio with realistic made-up bookings and money for a demo, then wipe it clean.",
  "Studios cannot see each other":
    "Every question the app asks the database is locked to one studio. Files only open for the studio that owns them.",
  "One place that checks permissions":
    "Every part of the app asks the same piece of code whether this person is allowed. Because there is only one place to check, there is only one place to get right.",
  "Roles":
    "Owner, manager, engineer, staff and guest. Each role opens only its own part of the app.",
  "You get what you paid for":
    "The plan is checked in the code itself, so a locked feature stays locked even if someone finds its address.",
  "A permanent record":
    "Pulse writes down every refund, approval, invite and signature. It can add new entries, and nobody can change or delete an old one.",
  "Clients can get or delete their data":
    "A client can ask for a copy of everything held about them, or ask for it to be deleted. The law says the studio has to do both, so Pulse builds both in.",
  "Guest links that expire":
    "A guest link opens one thing only, stops working after a set time, and can be switched off early.",
  "Allowances counted per plan":
    "Pulse counts how much the assistant, the file storage and any extra allowance are used, and caps them at what the plan includes.",
  "Use it before setup is finished":
    "The studio can start working the moment they sign up and finish setting up later. The first booking does not have to wait for it.",
  "We move your data for free":
    "Pulse copies the studio's existing information across for them at no charge, and they are running in a day. Rival software often takes months to set up.",
  "No contract":
    "Cancel any month. There is no year-long agreement, and nothing extra to buy for the things other companies charge for on the side.",
  "Thousands of automatic checks":
    "Automatic tests run on their own over the money, the rule that keeps one studio's records away from another, and what each plan includes.",
  "Post-production project tracking":
    "Each record gets a project with stages from tracking through mixing, mastering and delivery. Tasks, owners, due dates and deliverables sit on cards like the job board and on the today screen, linked to the sessions, songs, rooms, engineers and bills.",
  "Projects across every studio":
    "For a company with many studios: every project in every studio, in one view.",
  "Media file management with version control":
    "One searchable library for sessions, stems, mixes, masters, artwork and deliverables. Every upload is a numbered version with its history and notes, and the client approves the version they want.",
  "One media library shared across studios":
    "For a company with many studios: one library every studio can draw from, while each studio's own files stay its own.",
  "Barcode equipment check-in and check-out":
    "Print or assign a barcode label for each piece of gear. Scan it with a phone camera to check it out to a person, a session or a rental and back in again. Pulse shows who has what, what is overdue, and keeps the history on the item.",
};

/* The one name used in two groups carries a different line in the second. */
const DESC_IN_GROUP: Record<string, Record<string, string>> = {
  agency: {
    "Your own price list":
      "The plans you resell to your studios, with offers and different terms for one account if you want. Free trials take a card at the start and renew automatically after; the beta is the one plan with no card.",
  },
};

function describe(groupId: string, name: string): string {
  return DESC_IN_GROUP[groupId]?.[name] ?? DESC[name] ?? "";
}

/** Built features only, grouped as in the config. Groups with nothing built
 *  are dropped. */
function sectionsFrom(groups: FeatureGroup[]): Section[] {
  return groups
    .map((g) => ({
      id: g.id,
      title: g.title,
      note: g.salesNote,
      ...(g.isNew ? { isNew: true } : {}),
      items: g.items
        .filter((x) => x.built)
        .map((x) => ({
          name: x.name,
          desc: describe(g.id, x.name),
          tier: x.tier,
          ...(x.moved ? { moved: true } : {}),
        })),
    }))
    .filter((s) => s.items.length > 0);
}

export const SECTIONS: Section[] = sectionsFrom(FEATURE_GROUPS);

export const TOTAL_FEATURES = SECTIONS.reduce((n, s) => n + s.items.length, 0);

/** Built features per cheapest tier, from the config. */
export const TIER_TOTALS: Record<TierKey, number> = tierTotals(
  FEATURE_GROUPS.map((g) => ({ ...g, items: g.items.filter((x) => x.built) })),
);

/** Features that moved to a cheaper plan in the repack, as shown. */
export const MOVED_COUNT = SECTIONS.reduce(
  (n, s) => n + s.items.filter((x) => x.moved).length,
  0,
);

/* Not built. Here so a rep can answer "do you do X?" honestly and still sound
   like they know where the product is going. Never pitch as live. The titles
   are NOT_BUILT_YET in the pricing config; the words are here. */
export type Roadmap = { kind: string; title: string; what: string; why: string };

const ROADMAP_DETAIL: Record<string, Omit<Roadmap, "title">> = {
  "A public list of studios on Pulse": {
    kind: "Big bet",
    what: "A free page anyone can search, showing every studio using Pulse and the hours they have free. Artists find a studio and book it there and then.",
    why: "Today Pulse is a cost to the studio. This would make it bring work in, which is the thing every owner says they need.",
  },
  "Paying the engineer automatically": {
    kind: "Big bet",
    what: "When a session ends, Pulse works out the engineer's share and lines up the payment. It uses the clock-in times and the song ownership forms it already holds.",
    why: "No competitor does this, and a studio that comes to rely on it is unlikely to move.",
  },
  "A cheaper plan paid for by payments": {
    kind: "Big bet",
    what: "A lower monthly plan for studios that run their card payments through Pulse, where Pulse takes a small slice of each payment instead. Later, paying studios out the same day, and lending against future bookings.",
    why: "Studios stop saying it is too expensive. What Pulse earns rises only when the studio earns more.",
  },
  "A yearly report on the studio business": {
    kind: "Big bet",
    what: "Pulse would publish real numbers from all its studios with every name removed. The report would show what studios charge, how full their rooms are, and how often clients miss sessions, split by city and by room type.",
    why: "Owners have no idea what everyone else charges, and these numbers are not published anywhere.",
  },
  "A page comparing us to the main rival": {
    kind: "Sales and marketing",
    what: "A plain, factual comparison. With Pulse the studio pays monthly, where the rival asks them to sign for a year. The calendar link and the extra staff logins are included, where the rival charges for both.",
    why: "Studios switch the morning after they lose money, and this is the page they would find that morning.",
  },
  "The moving promise, in writing": {
    kind: "Sales and marketing",
    what: "A promise printed where the prices are: we move your data for free and you are running within a day.",
    why: "Studios say the reason they stay put is that moving sounds painful. It costs us little to promise and it is hard for a rival to match.",
  },
  "Typing the card number into the page": {
    kind: "Nearly done",
    what: "Saving a card and charging it later both work now. The box where the client types their card number is the last piece.",
    why: "Charging for a missed session already works, it just takes an extra step. This makes it one step.",
  },
  "Counting visits to the booking page": {
    kind: "Nearly done",
    what: "Recording how many people open the booking page, so the studio can see how many looked, how many booked and how many paid.",
    why: "Pulse already knows what the page earned. Without visit counts it cannot say how many visitors it took to earn it.",
  },
  "Turning a suggestion into a standing rule": {
    kind: "Nearly done",
    what: "Take something the assistant suggests and make it a permanent rule in one click, instead of approving the same thing every week.",
    why: "The studio would only have to make each decision once.",
  },
};

export const ROADMAP: Roadmap[] = NOT_BUILT_YET.map((title) => ({
  title,
  ...(ROADMAP_DETAIL[title] ?? { kind: "Not built", what: "", why: "" }),
}));
