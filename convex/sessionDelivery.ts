import { query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { staffSession, staffSessionOrNull, holds } from "./lib/sessionAccess";
import { currentMoneySight } from "./lib/tenant";
import { notify } from "./lib/notify";
import { appUrl } from "./lib/links";
import { orgTz } from "./lib/tz";
import { publicFileUrl, signedDownloadUrl } from "./lib/media";
import { filesReadyEmail, payToUnlockEmail } from "./lib/emailTemplates/sessionDelivery";
import { checkoutBalanceCents, checkoutChargeCents, checkoutKindsOffered, checkoutPaymentMode, onlineCardPayments } from "./lib/checkout";

/* ============================================================
   Session file delivery: the booking's Final files, handed to the client
   once the team says they are ready AND the booking is paid.

   One `sessionDeliveries` row per booking holds the link token, the state and
   the stats. A file is part of the delivery when its mediaAssets row is
   `clientFinal`; working files are never shown to the client.

     (none) --markReady--> balance 0 ? released (files email)
                                     : awaiting_payment (pay email, once)
     awaiting_payment --payment / comp leaves 0 owed--> released
     awaiting_payment --releaseNow (owner, manager)--> released
     released | awaiting_payment --turnOff--> off --markReady--> new token

   Who (staff, through staffSession like the rest of session files; the studio
   always comes from the caller, never from an argument):
     setFinal, markReady, resend, link   deliverables.upload (owner, manager, engineers)
     releaseNow, turnOff                 schedule.manage (owners, managers)
     status                              sessions.read; the amount only with money sight

   Public, token only (the /delivery/<token> page):
     page      what the client sees; never a file URL, a storage key or the token
     fileUrl   one ten minute signed GET per click, only when released, only
               for the latest version of a Final file of THIS booking
     opened    stamps when the page was opened
   Every way a link can be dead (malformed, unknown, off, expired, cancelled
   or no-show booking, no Final file left) answers exactly like an unknown link.

   A no-show is treated exactly like a cancelled booking everywhere in this
   file (isClosed): a no-show bills a fee, not the rate, so the gate's "owed"
   means nothing for it, and nothing on it is delivered. The status card tells
   the two apart (`cancelled`, `noShow`).
   ============================================================ */

export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const URL_TTL_S = 600;
export const URL_RATE_MAX = 120;
export const URL_RATE_WINDOW_MS = 3_600_000;
export const OPENED_MIN_GAP_MS = 60_000;
/** Resend at most this often: every send is an email to the client. */
export const RESEND_MIN_GAP_MS = 2 * 60_000;

/** Bound on the Final files read for one booking. The index holds only Final
 *  rows of this booking, so working files never count against it. */
const MAX_FILES = 200;

type Ctx = QueryCtx | MutationCtx;
type Delivery = Doc<"sessionDeliveries">;

/** The client's link. The token is the only credential the page has. */
export function deliveryUrl(token: string): string {
  return `${appUrl().replace(/\/$/, "")}/delivery/${token}`;
}

/** 32 random bytes, hex. */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type FinalFile = { asset: Doc<"mediaAssets">; version: Doc<"mediaVersions"> };

/** The latest version of each Final file on this booking in this studio,
 *  newest upload first. */
export async function finalFiles(ctx: Ctx, orgId: string, sessionId: Id<"sessions">): Promise<FinalFile[]> {
  const assets = await ctx.db
    .query("mediaAssets")
    .withIndex("by_org_session_final", (q) => q.eq("orgId", orgId).eq("sessionId", sessionId).eq("clientFinal", true))
    .take(MAX_FILES);
  const out: FinalFile[] = [];
  for (const asset of assets) {
    if (asset.clientFinal !== true || asset.orgId !== orgId || asset.sessionId !== sessionId) continue;
    const version = await ctx.db
      .query("mediaVersions")
      .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
      .order("desc")
      .first();
    if (!version || version.orgId !== orgId) continue;
    out.push({ asset, version });
  }
  out.sort((a, b) => b.version.uploadedAt - a.version.uploadedAt);
  return out;
}

/** Kill a delivery's link for good: off, and the token replaced by a fresh
 *  random one nobody holds, so the old link answers like an unknown one even
 *  if the row is later turned back on. Used when a client's data is erased. */
export async function retireDeliveryLink(ctx: MutationCtx, delivery: Delivery, patch?: Partial<Pick<Delivery, "sentTo">>): Promise<void> {
  await ctx.db.patch(delivery._id, { ...patch, status: "off", offAt: Date.now(), token: newToken() });
}

async function deliveryFor(ctx: Ctx, sessionId: Id<"sessions">): Promise<Delivery | null> {
  return await ctx.db
    .query("sessionDeliveries")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .first();
}

/** A booking nothing is delivered on: cancelled, or a no-show. Every place in
 *  this file that refuses or kills a delivery for a cancelled booking asks
 *  this, so the two can never drift apart. */
export function isClosed(session: Pick<Doc<"sessions">, "status">): boolean {
  return session.status === "cancelled" || session.status === "no_show";
}

async function orgRow(ctx: Ctx, orgId: string): Promise<Doc<"orgs"> | null> {
  return await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
}

/* ── What is still owed ─────────────────────────────────────────
   A booking is paid two ways: booking payments (settlePayment, which moves
   `amountPaidCents`) and invoices tied to the booking (`invoices.sessionId`,
   paid online, by hand or by a saved card), which never touch
   `amountPaidCents`. Both count. Only an invoice with status "paid", this
   booking's sessionId and this booking's studio counts, by its amountCents; a
   draft, sent, viewed, overdue or void invoice counts for nothing.

   Booking payments are credited the way createCompletionInvoice credits them
   (sessions.ts): the larger of `amountPaidCents` and, for a row whose deposit
   is recorded only by the old `depositPaid` flag, `depositCents`. Larger, not
   the sum: a ledgered deposit sets both.

   "Nothing owed" must never be true while money is owed, so every doubtful
   number errs toward owed: a rate that is not a finite, non-negative number is
   owed in full forever (never releases), and a paid amount that is not a finite
   positive number counts as nothing paid. */

/** Bound on the invoices read for one booking (a booking has one or two). Past
 *  it, later invoices are not counted, which can only keep a delivery locked. */
const MAX_INVOICES = 100;
const OPEN_INVOICE = new Set(["sent", "viewed", "overdue"]);

function positiveCents(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

type OwedFields = Pick<Doc<"sessions">, "rateCents" | "amountPaidCents" | "depositPaid" | "depositCents">;

/** Booking payments credited against the rate: max(amountPaidCents, the
 *  deposit when `depositPaid`), the createCompletionInvoice rule. */
export function bookingPaidCents(session: Pick<OwedFields, "amountPaidCents" | "depositPaid" | "depositCents">): number {
  return Math.max(positiveCents(session.amountPaidCents), session.depositPaid === true ? positiveCents(session.depositCents) : 0);
}

/** Cents still owed, given what the booking's paid invoices add up to.
 *  Infinity when the rate itself is broken. Pure. */
export function owedFrom(session: OwedFields, paidByInvoiceCents: number): number {
  const rate = session.rateCents;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, rate - bookingPaidCents(session) - positiveCents(paidByInvoiceCents));
}

type Ledger = { owed: number; invoices: Array<Doc<"invoices">> };

/** What the booking still owes, and its invoices (this booking, this studio). */
async function bookingLedger(ctx: Ctx, session: Doc<"sessions">): Promise<Ledger> {
  const rows = await ctx.db
    .query("invoices")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .take(MAX_INVOICES);
  const invoices = rows.filter((inv) => inv.orgId === session.orgId && inv.sessionId === session._id);
  const paidByInvoice = invoices.filter((inv) => inv.status === "paid").reduce((sum, inv) => sum + positiveCents(inv.amountCents), 0);
  return { owed: owedFrom(session, paidByInvoice), invoices };
}

/** max(0, rate - booking payments - paid invoices on this booking), in cents.
 *  Infinity (owed, never releases) when the rate is not a usable number. */
export async function owedOnBooking(ctx: Ctx, session: Doc<"sessions">): Promise<number> {
  return (await bookingLedger(ctx, session)).owed;
}

/** An amount fit to show: null for a broken rate's Infinity. */
function shownCents(owed: number): number | null {
  return Number.isFinite(owed) ? owed : null;
}

/* ── Where the Pay button goes ──────────────────────────────────
   The rule: the delivery page and the pay email offer an online Pay button
   only when the amount that target will charge is exactly what is owed (the
   amount the client is shown). Otherwise there is no button and the client is
   told to pay the invoice the studio sent when one is open (P4-02, P4-03), or
   that the studio will send a way to pay. Pulse keeps two payment records and
   each pay page computes its own amount, so a button is offered only where the
   two agree, never by guessing which one is right.

     invoice   prices are not hidden, exactly one invoice on the booking is
               sent, viewed or overdue, and its stored amountCents (what
               invoicePay charges) is owed
     checkout  the booking has no invoice but void ones, prices are not hidden,
               and every amount the checkout page offers this booking is owed,
               both what it CHARGES (lib/checkout.ts, the functions
               booking.payViaStripe charges with) and what it DISPLAYS (the
               deposit card shows depositCents even when the charge is capped
               at a smaller balance; the full card shows rateCents)
     A booking with hidden prices never has a target: the page shows no
     amount, and a button with no amount beside it is not offered. The client
     pays the invoice the studio sent, and the page unlocks by itself.
     none      nothing_owed; invoice_not_sent (one draft invoice would be the
               target once sent); prices_hidden; open_invoice_wrong_amount (an
               invoice is sent, viewed or overdue but none qualifies, so the
               team must void or correct it rather than send another);
               amount_mismatch (anything else, including a studio that cannot
               take cards online with no invoice open, since both pay pages
               then charge nothing)
   Both targets also need the studio's online card payments on: without them
   neither pay page can charge anything. */

export type PayTarget =
  | { kind: "invoice"; url: string; cents: number }
  | { kind: "checkout"; url: string; cents: number }
  | { kind: "none"; reason: "invoice_not_sent" | "amount_mismatch" | "prices_hidden" | "nothing_owed" | "open_invoice_wrong_amount" };

export type PayTargetInput = {
  session: Pick<Doc<"sessions">, "_id" | "rateCents" | "amountPaidCents" | "depositCents" | "depositPaid" | "pricingHidden" | "status">;
  /** This booking's invoices in this studio. */
  invoices: Array<Pick<Doc<"invoices">, "_id" | "status" | "amountCents">>;
  /** owedFrom(session, paid invoices). */
  owed: number;
  /** The checkout page's payment mode for the booking (checkoutPaymentMode). */
  paymentMode: "deposit" | "full";
  /** onlineCardPayments(org). */
  cardsOn: boolean;
  orgSlug: string | null;
  /** The app's base URL, no trailing slash. */
  base: string;
};

/** The decision, from facts already read. Pure. */
export function decidePayTarget(x: PayTargetInput): PayTarget {
  const { session, owed } = x;
  if (owed === 0) return { kind: "none", reason: "nothing_owed" };
  // A cancelled booking can no longer be paid at its checkout, a no-show bills
  // a fee and not the rate, and nothing on either is delivered anyway.
  if (isClosed(session)) return { kind: "none", reason: "amount_mismatch" };
  // A broken rate (Infinity) or anything odd: no amount is certain.
  if (!Number.isFinite(owed) || owed < 0 || !Number.isInteger(owed)) return { kind: "none", reason: "amount_mismatch" };

  // Hidden prices: never a button (the page shows no amount to match it).
  if (session.pricingHidden === true) return { kind: "none", reason: "prices_hidden" };

  const live = x.invoices.filter((inv) => inv.status !== "void");
  const open = live.filter((inv) => OPEN_INVOICE.has(inv.status));
  const drafts = live.filter((inv) => inv.status === "draft");

  // The open invoice: the client pays its stored amount (invoicePay).
  if (x.cardsOn && open.length === 1 && open[0].amountCents === owed) {
    return { kind: "invoice", url: `${x.base}/pay/invoice/${open[0]._id}`, cents: open[0].amountCents };
  }

  // The booking checkout: only with no invoice in play at all, and every
  // amount it offers, as charged and as displayed, exactly what is owed.
  if (x.cardsOn && live.length === 0 && x.orgSlug) {
    const kinds = checkoutKindsOffered(session, x.paymentMode);
    const balanceCents = checkoutBalanceCents(session);
    const charged = kinds.map((k) => checkoutChargeCents({ depositCents: session.depositCents, balanceCents }, k));
    // What src/app/book/[slug]/checkout/[sessionId]/page.tsx prints for each
    // kind: the deposit card depositCents, the full card rateCents, the
    // balance section balanceCents.
    const displayed = kinds.map((k) => (k === "deposit" ? session.depositCents : k === "full" ? session.rateCents : balanceCents));
    if (kinds.length > 0 && [...charged, ...displayed].every((c) => c === owed)) {
      return { kind: "checkout", url: `${x.base}/book/${x.orgSlug}/checkout/${session._id}`, cents: owed };
    }
  }

  // Sending the one draft would make it the target.
  if (x.cardsOn && open.length === 0 && drafts.length === 1 && drafts[0].amountCents === owed) {
    return { kind: "none", reason: "invoice_not_sent" };
  }
  // An invoice is already open and none of them is a target: the fix is to
  // void or correct it, never to send a second payable invoice.
  if (open.length > 0) return { kind: "none", reason: "open_invoice_wrong_amount" };
  return { kind: "none", reason: "amount_mismatch" };
}

type PayFacts = { owed: number; target: PayTarget; invoices: Array<Doc<"invoices">>; cardsOn: boolean };

async function payFacts(ctx: Ctx, session: Doc<"sessions">, org: Doc<"orgs"> | null): Promise<PayFacts> {
  const [ledger, room] = await Promise.all([bookingLedger(ctx, session), session.roomId ? ctx.db.get(session.roomId) : null]);
  const cardsOn = !!org && org.orgId === session.orgId && onlineCardPayments(org);
  const target = decidePayTarget({
    session,
    invoices: ledger.invoices,
    owed: ledger.owed,
    paymentMode: checkoutPaymentMode(room && room.orgId === session.orgId ? room : null),
    cardsOn,
    orgSlug: org?.slug ?? null,
    base: appUrl().replace(/\/$/, ""),
  });
  return { owed: ledger.owed, target, invoices: ledger.invoices, cardsOn };
}

/** Whether any of the booking's invoices is sent, viewed or overdue: the
 *  client already holds an invoice to pay (P4-02, P4-03). */
function hasOpenInvoice(invoices: Array<Pick<Doc<"invoices">, "status">>): boolean {
  return invoices.some((inv) => OPEN_INVOICE.has(inv.status));
}

/** How many open invoices the status card lists by number and amount. */
const LISTED_OPEN_INVOICES = 5;

/** The facts the team card states about paying (R5-01): the open invoices
 *  (sent, viewed or overdue; oldest first, at most five listed, the real count
 *  beside them), the drafts, hidden prices and whether the studio takes cards
 *  online. Money: the status query returns it only to callers with money
 *  sight. `invoices` is this booking's in this studio (bookingLedger reads the
 *  by_session index, oldest first, bounded). */
export type CardPayFacts = {
  openInvoices: Array<{ number: string; cents: number }>;
  openInvoiceCount: number;
  draftInvoices: number;
  pricesHidden: boolean;
  cardsOn: boolean;
};

function cardPayFacts(session: Pick<Doc<"sessions">, "pricingHidden">, pay: PayFacts): CardPayFacts {
  const open = pay.invoices.filter((inv) => OPEN_INVOICE.has(inv.status));
  return {
    openInvoices: open.slice(0, LISTED_OPEN_INVOICES).map((inv) => ({ number: inv.number, cents: inv.amountCents })),
    openInvoiceCount: open.length,
    draftInvoices: pay.invoices.filter((inv) => inv.status === "draft").length,
    pricesHidden: session.pricingHidden === true,
    cardsOn: pay.cardsOn,
  };
}

/** Where the client can pay this booking online for exactly what is owed, or
 *  why there is no such place. */
export async function payTargetFor(ctx: Ctx, session: Doc<"sessions">, org: Doc<"orgs"> | null): Promise<PayTarget> {
  return (await payFacts(ctx, session, org)).target;
}

const PRICE_BROKEN = "This booking's price needs fixing first.";
const CANCELLED = "This booking was cancelled.";
const NO_SHOW = "This booking was a no-show, so there is nothing to deliver.";

/** Refuse a staff action on a booking nothing is delivered on, saying why. */
function refuseClosed(session: Pick<Doc<"sessions">, "status">): void {
  if (session.status === "cancelled") throw new ConvexError(CANCELLED);
  if (session.status === "no_show") throw new ConvexError(NO_SHOW);
}

/** Client types that are a person, greeted by first name. A band, a label
 *  and "other" (a company) are greeted by their whole name. */
const PERSON_TYPES = new Set<Doc<"artists">["type"]>(["artist", "producer", "songwriter"]);
/** First words that are an article, a title or part of a stage name, never a
 *  first name: matched as the whole first word, any case, with or without a
 *  trailing period. */
const NOT_A_FIRST_NAME = new Set([
  "the", "a", "an", "dj", "mc", "lil", "big", "young", "yung",
  "dr", "mr", "mrs", "ms", "sir", "king", "queen", "saint", "st",
]);

/** The name to greet a client by. "" for none and for an erased client. A
 *  person is greeted by the first word only when the name has two or three
 *  words, that word has at least three letters and it is not an article, a
 *  title or a stage-name prefix ("Jordan Ellis" -> "Jordan"; "Lil Baby", "DJ
 *  Premier", "The Midnight Tape", "Prince" -> the whole name). A band, label or
 *  company is always greeted by its whole name. The card, both emails and the
 *  page all use it. */
export function greetingName(artist: Pick<Doc<"artists">, "name" | "type" | "erasedAt"> | null | undefined): string {
  if (!artist || artist.erasedAt) return "";
  const name = (artist.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (!PERSON_TYPES.has(artist.type)) return name;
  const words = name.split(" ");
  if (words.length < 2 || words.length > 3) return name;
  const first = words[0];
  const letters = (first.match(/\p{L}/gu) ?? []).length;
  if (letters < 3 || NOT_A_FIRST_NAME.has(first.toLowerCase().replace(/\.$/, ""))) return name;
  return first;
}

/** "November 10" in the studio's zone. */
function sessionDay(ts: number, tz: string): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: tz });
}

/** "December 13, 2026" in the studio's zone. */
function longDate(ts: number, tz: string): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: tz });
}

/** "Dec 13, 2026" in the studio's zone. */
function shortDate(ts: number, tz: string): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
}

type Facts = {
  session: Doc<"sessions">;
  org: Doc<"orgs"> | null;
  artist: Doc<"artists"> | null;
  files: FinalFile[];
  /** Cents still owed (owedOnBooking): booking payments and paid invoices. */
  owed: number;
  /** Where the client can pay exactly `owed` online, if anywhere. */
  target: PayTarget;
  /** An invoice on the booking is sent, viewed or overdue (P4-03). */
  invoiceOpen: boolean;
};

async function facts(ctx: MutationCtx, delivery: Delivery): Promise<Facts | null> {
  const session = await ctx.db.get(delivery.sessionId);
  if (!session || session.orgId !== delivery.orgId) return null;
  const org = await orgRow(ctx, delivery.orgId);
  const [artist, files, pay] = await Promise.all([
    ctx.db.get(session.artistId),
    finalFiles(ctx, delivery.orgId, delivery.sessionId),
    payFacts(ctx, session, org),
  ]);
  return {
    session,
    org,
    artist: artist && artist.orgId === delivery.orgId ? artist : null,
    files,
    owed: pay.owed,
    target: pay.target,
    invoiceOpen: hasOpenInvoice(pay.invoices),
  };
}

type Email = Parameters<typeof notify>[1];

/* Every function below that writes reads and checks everything first, then
   writes. settlePayment catches a failure from onBalanceSettled (a payment must
   never be undone by a delivery problem), and a Convex mutation has no
   sub-transaction: a write made before a throw would stay. So the email is
   rendered and every patch is computed before the first write. */

/** The email for the delivery's state to the booked email, rendered but not
 *  queued. Null when it cannot go: no email on file, or no Final file left (a
 *  delivery email never goes out empty). Reads nothing, writes nothing. */
function emailFor(
  delivery: Pick<Delivery, "orgId" | "sessionId" | "token" | "expiresAt">,
  f: Facts,
  kind: "ready" | "pay",
  paidCents?: number,
): Email | null {
  const email = f.artist?.email?.trim();
  if (!email || f.files.length === 0) return null;
  const tz = orgTz(f.org);
  const hidden = f.session.pricingHidden === true;
  const common = {
    firstName: greetingName(f.artist),
    title: f.session.title,
    sessionDate: sessionDay(f.session.startTime, tz),
    files: f.files.map((x) => ({ name: x.asset.name, size: x.version.size })),
    url: deliveryUrl(delivery.token),
    accent: f.org?.accentColor,
  };
  // Never a pay email for an amount nobody can pay ("$Infinity").
  if (kind === "pay" && shownCents(f.owed) === null) throw new ConvexError(PRICE_BROKEN);
  // A booking with hidden prices never shows the client an amount, not even
  // what they just paid. Without a pay target the pay email has no button and
  // says to pay the invoice the studio sent when one is open now (P4-03), or
  // that the studio will send a way to pay (payTargetFor).
  const m =
    kind === "ready"
      ? filesReadyEmail({ ...common, expiresOn: longDate(delivery.expiresAt, tz), paidCents: hidden ? undefined : paidCents })
      : payToUnlockEmail({
          ...common,
          balanceCents: hidden ? null : f.owed,
          payOnline: f.target.kind !== "none",
          invoiceOpen: f.invoiceOpen,
          studioName: f.org?.name?.trim() || "The studio",
        });
  return {
    orgId: delivery.orgId,
    channel: "email",
    recipient: email,
    subject: m.subject,
    body: m.text,
    kind: kind === "ready" ? "delivery.ready" : "delivery.pay",
    sessionId: delivery.sessionId,
    html: m.html,
    accent: f.org?.accentColor,
  };
}

type ReleasePlan = {
  patch: Pick<Delivery, "status" | "releasedAt" | "releasedBy" | "expiresAt" | "sentTo" | "lastSentAt" | "sendCount">;
  email: Email;
};

/** What releasing would write: a fresh 30 days and the files email. Null when
 *  the files email cannot go, in which case nothing is released. Pure. */
function planRelease(
  delivery: Pick<Delivery, "orgId" | "sessionId" | "token" | "sendCount">,
  by: string,
  f: Facts,
  now: number,
  paidCents?: number,
): ReleasePlan | null {
  const expiresAt = now + LINK_TTL_MS;
  const email = emailFor({ ...delivery, expiresAt }, f, "ready", paidCents);
  if (!email) return null;
  return {
    patch: {
      status: "released",
      releasedAt: now,
      releasedBy: by,
      expiresAt,
      sentTo: email.recipient,
      lastSentAt: now,
      sendCount: delivery.sendCount + 1,
    },
    email,
  };
}

/** The one place an existing delivery becomes released. Every read happened
 *  before (the caller's `facts`) and every check happens here before the first
 *  write. Returns false, having written nothing, when the files email cannot
 *  go; true when the delivery was released and the email queued. */
async function release(ctx: MutationCtx, delivery: Delivery, by: string, f: Facts, paidCents?: number): Promise<boolean> {
  const plan = planRelease(delivery, by, f, Date.now(), paidCents);
  if (!plan) return false;
  // The email first: if queueing it fails, the row is still unchanged.
  await notify(ctx, plan.email);
  await ctx.db.patch(delivery._id, plan.patch);
  return true;
}

/** Releases a delivery that was waiting for payment once the booking owes
 *  nothing (owedOnBooking: booking payments plus paid invoices), exactly once.
 *  Returns true only when it released one and queued the files email (so the
 *  caller can skip its own receipt email). Any other case, including one where
 *  the files email cannot go (no email on file, no Final file left), writes
 *  nothing and returns false. Callers outside this file use
 *  `settleDeliveryQuietly` or `settleDeliveryForInvoice`, never this. */
export async function onBalanceSettled(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  opts?: { paidCents?: number },
): Promise<boolean> {
  const delivery = await deliveryFor(ctx, sessionId);
  if (!delivery || delivery.status !== "awaiting_payment") return false;
  const f = await facts(ctx, delivery);
  if (!f || isClosed(f.session) || f.owed > 0) return false;
  return await release(ctx, delivery, "payment", f, opts?.paidCents);
}

/** The release trigger as every money path calls it, after its own writes:
 *  settlePayment, setComp, payDeposit, applyReschedule, packages.redeem and the
 *  three invoice paths (through settleDeliveryForInvoice). A delivery problem
 *  must never undo or block the money write that called it, so a failure is
 *  caught and logged (its message only: never a token or an address) and
 *  answers false. Every read and check in onBalanceSettled happens before its
 *  first write, so a caught failure leaves nothing half written. */
export async function settleDeliveryQuietly(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  opts?: { paidCents?: number },
): Promise<boolean> {
  try {
    return await onBalanceSettled(ctx, sessionId, opts);
  } catch (err) {
    console.error("[sessionDelivery] release failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** The trigger for an invoice that just became paid (invoicePay.settleInvoice,
 *  invoices.setStatus, cardOnFile._markFeePaid). Only an invoice tied to a
 *  booking of its own studio can release anything. `paidCents` is what the
 *  client paid now, for the files email's "Payment received" line; leave it out
 *  when no money came in (studio credit). */
export async function settleDeliveryForInvoice(
  ctx: MutationCtx,
  inv: Pick<Doc<"invoices">, "orgId" | "sessionId">,
  opts?: { paidCents?: number },
): Promise<boolean> {
  if (!inv.sessionId) return false;
  const session = await ctx.db.get(inv.sessionId);
  if (!session || session.orgId !== inv.orgId) return false;
  return await settleDeliveryQuietly(ctx, session._id, opts);
}

/* ── Staff ──────────────────────────────────────────────────── */

/** Mark a session file Final (part of the client's delivery) or back to a
 *  working file. Unmarking takes it off the client page at once. */
export const setFinal = mutation({
  args: { assetId: v.id("mediaAssets"), final: v.boolean() },
  handler: async (ctx, { assetId, final }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset?.sessionId) throw new ConvexError("File not found.");
    const access = await staffSession(ctx, asset.sessionId, "deliverables.upload");
    if (asset.orgId !== access.orgId) throw new ConvexError("File not found.");
    await ctx.db.patch(assetId, { clientFinal: final });
    return null;
  },
});

/** The delivery card: state, Final file count, the booked email, stats and what
 *  the caller may do. The balance amount only for callers with money sight. */
export const status = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSessionOrNull(ctx, sessionId);
    if (!access) return null;
    const { orgId, session, viewer } = access;
    const org = await orgRow(ctx, orgId);
    const [delivery, files, artist, sight, pay] = await Promise.all([
      deliveryFor(ctx, sessionId),
      finalFiles(ctx, orgId, sessionId),
      ctx.db.get(session.artistId),
      currentMoneySight(ctx),
      payFacts(ctx, session, org),
    ]);
    const balance = pay.owed;
    const d = delivery && delivery.orgId === orgId ? delivery : null;
    const clientEmail = (artist && artist.orgId === orgId ? artist.email?.trim() : undefined) || null;
    const state = d?.status ?? "none";
    const manage = holds(viewer, "schedule.manage");
    const cancelled = session.status === "cancelled";
    const noShow = session.status === "no_show";
    const closed = isClosed(session);
    return {
      state,
      finalCount: files.length,
      clientFirstName: greetingName(artist?.orgId === orgId ? artist : null),
      clientEmail,
      balanceDue: balance > 0,
      balanceCents: sight.money ? shownCents(balance) : null,
      sentTo: d?.sentTo ?? null,
      lastSentAt: d?.lastSentAt ?? null,
      sendCount: d?.sendCount ?? 0,
      firstOpenedAt: d?.firstOpenedAt ?? null,
      downloadCount: d?.downloadCount ?? 0,
      expiresAt: d?.expiresAt ?? null,
      offAt: d?.offAt ?? null,
      canMarkReady:
        holds(viewer, "deliverables.upload") && (state === "none" || state === "off") && files.length > 0 && !!clientEmail && !closed,
      canRelease: manage && state === "awaiting_payment" && !closed,
      canTurnOff: manage && (state === "awaiting_payment" || state === "released"),
      cancelled,
      noShow,
      // Where the client can pay online for exactly what is owed (payTargetFor).
      onlinePay: pay.target.kind,
      onlinePayReason: pay.target.kind === "none" ? pay.target.reason : null,
      // R5-01: the facts the card states (open invoices with their amounts,
      // drafts, hidden prices, cards on). Invoice numbers, amounts and counts
      // are money: the whole field is null without money sight.
      payFacts: sight.money ? cardPayFacts(session, pay) : null,
    };
  },
});

/** Ready to deliver. Paid (or nothing owed): released and the files email goes.
 *  Otherwise waiting for payment and one "pay to unlock" email. A booking that
 *  already has a live delivery is left as it is (a double tap sends nothing);
 *  one that was turned off gets a new token. */
export const markReady = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }): Promise<{ state: "awaiting_payment" | "released" }> => {
    const access = await staffSession(ctx, sessionId, "deliverables.upload");
    const { orgId, session } = access;
    refuseClosed(session);
    const files = await finalFiles(ctx, orgId, sessionId);
    if (files.length === 0) throw new ConvexError("Mark at least one file Final first.");
    const artist = await ctx.db.get(session.artistId);
    if (!artist || artist.orgId !== orgId || !artist.email?.trim()) throw new ConvexError("Add an email for this client first.");

    const existing = await deliveryFor(ctx, sessionId);
    if (existing && existing.orgId !== orgId) throw new ConvexError("Session not found.");
    if (existing && existing.status !== "off") return { state: existing.status };

    // Every read and check first; the row and the email are written last.
    const now = Date.now();
    const org = await orgRow(ctx, orgId);
    const pay = await payFacts(ctx, session, org);
    const owed = pay.owed;
    const f: Facts = { session, org, artist, files, owed, target: pay.target, invoiceOpen: hasOpenInvoice(pay.invoices) };
    const base = {
      orgId,
      sessionId,
      status: "awaiting_payment" as Delivery["status"],
      token: newToken(),
      expiresAt: now + LINK_TTL_MS,
      readyAt: now,
      readyBy: access.actorName,
      releasedAt: undefined as number | undefined,
      releasedBy: undefined as string | undefined,
      offAt: undefined,
      sentTo: undefined as string | undefined,
      lastSentAt: undefined as number | undefined,
      sendCount: 0,
      firstOpenedAt: undefined,
      lastOpenedAt: undefined,
      downloadCount: 0,
      urlWindowStart: undefined,
      urlCount: undefined,
    };
    let row: typeof base;
    let email: Email;
    let state: "awaiting_payment" | "released";
    if (owed === 0) {
      const plan = planRelease(base, "payment", f, now);
      if (!plan) throw new ConvexError("Add an email for this client first.");
      row = { ...base, ...plan.patch };
      email = plan.email;
      state = "released";
    } else {
      const pay = emailFor(base, f, "pay");
      if (!pay) throw new ConvexError("Add an email for this client first.");
      row = { ...base, sentTo: pay.recipient, lastSentAt: now, sendCount: 1 };
      email = pay;
      state = "awaiting_payment";
    }

    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("sessionDeliveries", row);
    await notify(ctx, email);
    return { state };
  },
});

/** "Send now anyway": an owner or manager releases a waiting delivery without
 *  payment. Recorded under their name. */
export const releaseNow = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSession(ctx, sessionId, "schedule.manage");
    refuseClosed(access.session);
    const delivery = await deliveryFor(ctx, sessionId);
    if (!delivery || delivery.orgId !== access.orgId || delivery.status !== "awaiting_payment") {
      throw new ConvexError("Nothing is waiting to send.");
    }
    const f = await facts(ctx, delivery);
    if (!f || f.files.length === 0) throw new ConvexError("Mark at least one file Final first.");
    if (!f.artist?.email?.trim()) throw new ConvexError("Add an email for this client first.");
    if (!(await release(ctx, delivery, access.actorName, f))) throw new ConvexError("Add an email for this client first.");
    return null;
  },
});

/** Turn off the link. The page answers like an unknown link from now on. */
export const turnOff = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSession(ctx, sessionId, "schedule.manage");
    const delivery = await deliveryFor(ctx, sessionId);
    if (!delivery || delivery.orgId !== access.orgId) throw new ConvexError("There is no link to turn off.");
    if (delivery.status === "off") return null;
    await ctx.db.patch(delivery._id, { status: "off", offAt: Date.now() });
    return null;
  },
});

/** Send the email for the current state again to the booked email, and start a
 *  fresh 30 days on the link. */
export const resend = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSession(ctx, sessionId, "deliverables.upload");
    refuseClosed(access.session);
    const delivery = await deliveryFor(ctx, sessionId);
    if (!delivery || delivery.orgId !== access.orgId || delivery.status === "off") {
      throw new ConvexError("There is no link to send. Tap Ready to deliver first.");
    }
    const now = Date.now();
    if (delivery.lastSentAt !== undefined && now - delivery.lastSentAt < RESEND_MIN_GAP_MS) {
      throw new ConvexError("Sent a moment ago. Try again in a couple of minutes.");
    }
    const f = await facts(ctx, delivery);
    if (!f || f.files.length === 0) throw new ConvexError("Mark at least one file Final first.");
    if (!f.artist?.email?.trim()) throw new ConvexError("Add an email for this client first.");
    // Waiting, but nothing is owed any more (a payment path that did not reach
    // the trigger): release instead of asking for money again.
    if (delivery.status === "awaiting_payment" && f.owed === 0) {
      if (!(await release(ctx, delivery, "payment", f))) throw new ConvexError("Add an email for this client first.");
      return null;
    }
    const expiresAt = now + LINK_TTL_MS;
    const email = emailFor({ ...delivery, expiresAt }, f, delivery.status === "released" ? "ready" : "pay");
    if (!email) throw new ConvexError("Add an email for this client first.");
    await ctx.db.patch(delivery._id, { expiresAt, sentTo: email.recipient, lastSentAt: now, sendCount: delivery.sendCount + 1 });
    await notify(ctx, email);
    return null;
  },
});

/** The client's link, for "Copy link". Called on demand, never subscribed, so
 *  the token does not sit in a live query result. */
export const link = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSessionOrNull(ctx, sessionId, "deliverables.upload");
    if (!access) return null;
    const delivery = await deliveryFor(ctx, sessionId);
    if (!delivery || delivery.orgId !== access.orgId || delivery.status === "off") return null;
    return { url: deliveryUrl(delivery.token) };
  },
});

/* ── Public (token only) ───────────────────────────────────── */

const TOKEN_RE = /^[0-9a-f]{64}$/;
const NOT_AVAILABLE = "That file is not available.";
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** A file name that is safe in a download header: no control characters,
 *  quotes, slashes or backslashes; at most 150 characters (the extension
 *  kept); "download" when nothing is left. */
export function safeDownloadName(name: string): string {
  let out = (name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "")
    .replace(/["'`/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const chars = Array.from(out);
  if (chars.length > 150) {
    const ext = /\.[^.\s]{1,10}$/.exec(out)?.[0] ?? "";
    out = Array.from(out.slice(0, out.length - ext.length)).slice(0, 150 - ext.length).join("").trim() + ext;
  }
  return out || "download";
}

/** The live delivery for a token, with its booking, or null for every way a
 *  link can be dead. Never says which. */
async function liveDelivery(ctx: Ctx, token: string): Promise<{ delivery: Delivery; session: Doc<"sessions"> } | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const delivery = await ctx.db
    .query("sessionDeliveries")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!delivery || delivery.token !== token) return null;
  if (delivery.status === "off" || delivery.expiresAt <= Date.now()) return null;
  const session = await ctx.db.get(delivery.sessionId);
  if (!session || session.orgId !== delivery.orgId || isClosed(session)) return null;
  return { delivery, session };
}

/** The client download page. Null (the same null) for any dead link. */
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const live = await liveDelivery(ctx, token);
    if (!live) return null;
    const { delivery, session } = live;
    const files = await finalFiles(ctx, delivery.orgId, delivery.sessionId);
    if (files.length === 0) return null;
    const locked = delivery.status !== "released";
    const org = await orgRow(ctx, delivery.orgId);
    const [artist, room, pay] = await Promise.all([
      ctx.db.get(session.artistId),
      session.roomId ? ctx.db.get(session.roomId) : null,
      locked ? payFacts(ctx, session, org) : null,
    ]);
    // Locked: a Pay button only where the amount it charges is what is owed
    // (payTargetFor); the amount itself never for a booking with hidden prices.
    const payUrl = pay && pay.target.kind !== "none" ? pay.target.url : null;
    const balanceCents = pay && session.pricingHidden !== true ? shownCents(pay.owed) : null;
    // R5-01, R5-03: locked and nothing owed (the delivery just has not
    // released yet), so the page says payment was received. Reveals no amount,
    // so it holds for hidden prices too. False once unlocked, and false for a
    // broken rate (owed is Infinity). The page says nothing about invoices.
    const nothingOwed = !!pay && pay.owed === 0;
    const accent = org?.accentColor?.trim();
    // Dates are formatted here, in the studio's zone, the same zone the email
    // uses, so the page and the email never disagree about the day.
    const tz = orgTz(org);
    return {
      studio: {
        name: org?.name ?? "Your studio",
        // A public page: only a file that is public anyway, never a signed
        // private-bucket URL, whatever logoId points at.
        logoUrl: org?.logoId ? await publicFileUrl(ctx, org.logoId) : null,
        accent: accent && HEX_RE.test(accent) ? accent : null,
      },
      booking: {
        title: session.title,
        startTime: session.startTime,
        dateLabel: longDate(session.startTime, tz),
        roomName: room && room.orgId === delivery.orgId ? room.name : null,
      },
      clientFirstName: greetingName(artist && artist.orgId === delivery.orgId ? artist : null),
      state: locked ? ("locked" as const) : ("unlocked" as const),
      files: files.map((f) => ({
        versionId: f.version._id,
        name: f.asset.name,
        size: f.version.size,
        mimeType: f.version.mimeType,
      })),
      totalBytes: files.reduce((sum, f) => sum + f.version.size, 0),
      balanceCents,
      payUrl,
      nothingOwed,
      expiresAt: delivery.expiresAt,
      expiresLabel: shortDate(delivery.expiresAt, tz),
    };
  },
});

/** One signed URL for one file, minted on click. Re-checks everything
 *  `page` checks, requires the delivery to be released and the version to be
 *  the latest of a Final file on this booking in this studio. `purpose` says
 *  why the page asked: only "download" (the default) adds to downloadCount, so
 *  pressing play is not reported to the studio as a download. Every URL minted,
 *  for either purpose, counts toward URL_RATE_MAX an hour per delivery. */
export const fileUrl = mutation({
  args: {
    token: v.string(),
    versionId: v.id("mediaVersions"),
    purpose: v.optional(v.union(v.literal("play"), v.literal("download"))),
  },
  handler: async (ctx, { token, versionId, purpose }): Promise<{ url: string; fileName: string }> => {
    const live = await liveDelivery(ctx, token);
    if (!live || live.delivery.status !== "released") throw new ConvexError(NOT_AVAILABLE);
    const { delivery } = live;

    const version = await ctx.db.get(versionId);
    if (!version || version.orgId !== delivery.orgId) throw new ConvexError(NOT_AVAILABLE);
    const asset = await ctx.db.get(version.assetId);
    if (
      !asset ||
      asset.orgId !== delivery.orgId ||
      asset.sessionId !== delivery.sessionId ||
      asset.clientFinal !== true
    ) {
      throw new ConvexError(NOT_AVAILABLE);
    }
    const latest = await ctx.db
      .query("mediaVersions")
      .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
      .order("desc")
      .first();
    if (!latest || latest._id !== version._id) throw new ConvexError(NOT_AVAILABLE);

    const now = Date.now();
    const fresh = !delivery.urlWindowStart || now - delivery.urlWindowStart >= URL_RATE_WINDOW_MS;
    const windowStart = fresh ? now : delivery.urlWindowStart!;
    const count = fresh ? 0 : (delivery.urlCount ?? 0);
    if (count >= URL_RATE_MAX) throw new ConvexError("Too many downloads. Try again in an hour.");

    const fileName = safeDownloadName(version.fileName);
    const url = await signedDownloadUrl(ctx, version.mediaId, { expiresIn: URL_TTL_S, fileName });
    if (!url) throw new ConvexError(NOT_AVAILABLE);
    await ctx.db.patch(delivery._id, {
      urlWindowStart: windowStart,
      urlCount: count + 1,
      downloadCount: delivery.downloadCount + ((purpose ?? "download") === "download" ? 1 : 0),
    });
    return { url, fileName };
  },
});

/** The safety net for a missed trigger. The page calls it once when it first
 *  renders locked: a waiting delivery whose booking no longer owes anything
 *  (some path lowered the balance without calling onBalanceSettled) is
 *  released through the same `release`, by "payment". Anything else (a balance
 *  still owed, already released, off, expired, cancelled or no-show, no Final file, no
 *  email on file) changes nothing. Never throws for a bad token. */
export const refresh = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const live = await liveDelivery(ctx, token);
    if (!live || live.delivery.status !== "awaiting_payment") return null;
    const f = await facts(ctx, live.delivery);
    if (!f || f.owed > 0) return null;
    await release(ctx, live.delivery, "payment", f);
    return null;
  },
});

/** The client opened the page. First and last opened, the last at most once a
 *  minute. Never throws, whatever the token. */
export const opened = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const live = await liveDelivery(ctx, token);
    if (!live) return null;
    const { delivery } = live;
    const now = Date.now();
    const patch: Partial<Pick<Delivery, "firstOpenedAt" | "lastOpenedAt">> = {};
    if (!delivery.firstOpenedAt) patch.firstOpenedAt = now;
    if (!delivery.lastOpenedAt || now - delivery.lastOpenedAt >= OPENED_MIN_GAP_MS) patch.lastOpenedAt = now;
    if (Object.keys(patch).length > 0) await ctx.db.patch(delivery._id, patch);
    return null;
  },
});
