import { internalMutation } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/* ============================================================
   Demo "rich ops" fill. Makes the operations, money and marketing
   screens of the demo studio look lived-in: gear out on loan, staff
   payouts, Stripe clearing + payouts, a bank feed, patch zones,
   social posts with results, promos and a versioned media library.

   Reuses the org's own equipment, members, artists, sessions, songs,
   invoices, patch spaces, social accounts and media files (by id;
   names are read at run time). Never edits a row it did not create.
   No Stripe, Plaid, GHL or R2 call is made.

   CALL ORDER (each is one small mutation, well under the write budget;
   every insert also writes a changeLog row through the trigger):
     1. fillA     gear checkouts, staff payouts, patch zones, package/membership revenue
     2. fillB     Stripe clearing entries + Stripe payouts (from paid invoices)
     3. fillBank  OPTIONAL demo bank feed (run AFTER fillB; links deposits to the payouts)
     4. fillC     social posts, promos, attributed booking visits
     5. fillD     media library assets, versions, notes, events
   e.g. npx convex run seedDemoRichOps:fillA '{"orgId":"<org>"}'

   IDEMPOTENCY TAGS (each fill wipes only its own tagged rows first):
     gearCheckouts         outByClerkUserId = "demo_rich"
     payouts               approvedBy/paidBy unused for tagging; note = "demo_rich"
     patchGroups           createdBy = "demo_rich"
     revenueEntries        providerReference starts "demo_rich_"
     stripeLedgerEntries   balanceTransactionId starts "txn_demo_rich_"
     stripePayouts         stripePayoutId starts "po_demo_rich_"
     bankConnections       plaidItemId = "demo_rich_item" (accounts + transactions
                           hang off it; transactions also plaidTransactionId "demo_rich_*")
     socialPosts           submittedBy = "demo_rich"
     promos                createdBy = "demo_rich"
     bookingVisits         visitorKey starts "demo_rich_"
     mediaAssets           searchText ends " demo_rich" (versions, notes, events
                           are removed with their tagged asset; mediaFiles never touched)

   Safety notes:
     - Overdue checkouts are stamped overdueNotifiedAt so the gear-overdue cron
       never alerts on them.
     - Scheduled posts carry ghlPostId "simulated:demo_rich-N": the status cron
       only flips them to published in the database, nothing goes to GHL.
     - Stripe payouts are never "ready", so matchReadyPayouts ignores them.
     - The bank connection has no token, so the bank-sync cron skips it.
   ============================================================ */

const TAG = "demo_rich";
const DAY = 86_400_000;
const HOUR = 3_600_000;

const utcDay = (ts: number) => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

async function resolveOrg(ctx: MutationCtx, orgId: string) {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!org) throw new Error(`No org ${orgId}`);
  return org;
}

/* ─────────────────────────── fillA ─────────────────────────── */

const PORTABLE = new Set(["mic", "headphones", "instrument", "synth", "interface", "preamp", "outboard", "midi", "monitor", "other"]);

export const fillA = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { orgId, nowMs }) => {
    const now = nowMs ?? Date.now();
    await resolveOrg(ctx, orgId);

    // ── wipe ──
    let removed = 0;
    const allCheckouts = await ctx.db.query("gearCheckouts").withIndex("by_org_open", (q) => q.eq("orgId", orgId)).collect();
    for (const r of allCheckouts) if (r.outByClerkUserId === TAG) { await ctx.db.delete(r._id); removed++; }
    for (const r of await ctx.db.query("payouts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (r.note === TAG) { await ctx.db.delete(r._id); removed++; }
    }
    for (const r of await ctx.db.query("patchGroups").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (r.createdBy === TAG) { await ctx.db.delete(r._id); removed++; }
    }
    for (const r of await ctx.db.query("revenueEntries").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if ((r.providerReference ?? "").startsWith(`${TAG}_`)) { await ctx.db.delete(r._id); removed++; }
    }

    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const equipment = await ctx.db.query("equipment").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    const outBy = owner?.name ?? "Front desk";

    // ── gear checkouts: 5 out (2 overdue, 1 no due date), 7 returned ──
    const stillOpen = new Set(
      (await ctx.db.query("gearCheckouts").withIndex("by_org_open", (q) => q.eq("orgId", orgId).eq("inAt", undefined)).collect())
        .map((r) => r.equipmentId as string),
    );
    const gear = equipment
      .filter((e) => PORTABLE.has(e.category) && e.status !== "retired" && e.status !== "maintenance" && !stillOpen.has(e._id))
      .sort((a, b) => Number(Boolean(a.installedInRoomId)) - Number(Boolean(b.installedInRoomId)) || a.name.localeCompare(b.name));
    const pastSessions = sessions
      .filter((s) => s.status === "completed" && s.endTime < now)
      .sort((a, b) => b.endTime - a.endTime);
    const upcoming = sessions
      .filter((s) => s.startTime > now && s.status !== "cancelled")
      .sort((a, b) => a.startTime - b.startTime);
    const engineers = members.filter((m) => m.role !== "owner");
    type Plan = {
      kind: "member" | "client" | "session" | "rental";
      outDaysAgo: number;
      dueInDays?: number;
      returnedDaysAgo?: number;
      notes?: string;
      returnNotes?: string;
    };
    const PLAN: Plan[] = [
      { kind: "rental", outDaysAgo: 6, dueInDays: -2, notes: "Weekend rental, deposit on card" },
      { kind: "client", outDaysAgo: 9, dueInDays: -1, notes: "Took home for writing sessions" },
      { kind: "member", outDaysAgo: 2, dueInDays: 3, notes: "Remote tracking date" },
      { kind: "session", outDaysAgo: 0.2, dueInDays: 0.5 },
      { kind: "rental", outDaysAgo: 1, dueInDays: 6, notes: "Week rental for a live show" },
      { kind: "client", outDaysAgo: 30, dueInDays: -23, returnedDaysAgo: 24, returnNotes: "Returned clean" },
      { kind: "rental", outDaysAgo: 22, dueInDays: -19, returnedDaysAgo: 18, returnNotes: "Back a day late, no damage" },
      { kind: "member", outDaysAgo: 16, dueInDays: -14, returnedDaysAgo: 14 },
      { kind: "session", outDaysAgo: 12, dueInDays: -12, returnedDaysAgo: 12 },
      { kind: "rental", outDaysAgo: 40, dueInDays: -37, returnedDaysAgo: 37, returnNotes: "Cable pouch missing, replaced" },
      { kind: "client", outDaysAgo: 50, dueInDays: -45, returnedDaysAgo: 46 },
      { kind: "member", outDaysAgo: 8, dueInDays: -6, returnedDaysAgo: 6, returnNotes: "Fresh batteries put in" },
    ];
    const RENTERS = ["Eastside Church AV team", "Northbound Productions", "Lena Ortiz (freelance engineer)", "Riverside Theater"];
    let checkouts = 0;
    for (let i = 0; i < PLAN.length && gear.length > 0; i++) {
      const p = PLAN[i];
      const open = p.returnedDaysAgo === undefined;
      // Open rows take distinct items; history may reuse items (non-overlapping times).
      const item = open ? gear[i % gear.length] : gear[(i + 5) % gear.length];
      if (open && i >= gear.length) continue;
      let holder: Partial<Doc<"gearCheckouts">> & { holderLabel: string; holderKind: Plan["kind"] };
      if (p.kind === "member" && engineers.length) {
        const m = engineers[i % engineers.length];
        holder = { holderKind: "member", holderMemberId: m._id, holderLabel: m.name };
      } else if (p.kind === "client" && artists.length) {
        const a = artists[(i * 3) % artists.length];
        holder = { holderKind: "client", holderArtistId: a._id, holderLabel: a.name };
      } else if (p.kind === "session" && (open ? upcoming.length || pastSessions.length : pastSessions.length)) {
        const s = open ? (upcoming[0] ?? pastSessions[0]) : pastSessions[i % pastSessions.length];
        holder = { holderKind: "session", holderSessionId: s._id, holderLabel: s.title };
      } else {
        holder = { holderKind: "rental", holderLabel: RENTERS[i % RENTERS.length] };
      }
      const outAt = now - p.outDaysAgo * DAY;
      const dueAt = p.dueInDays === undefined ? undefined : now + p.dueInDays * DAY;
      const overdue = open && dueAt !== undefined && dueAt < now;
      await ctx.db.insert("gearCheckouts", {
        orgId,
        equipmentId: item._id,
        equipmentName: item.name,
        ...(item.barcode ? { barcode: item.barcode } : {}),
        ...holder,
        outAt,
        ...(dueAt !== undefined ? { dueAt } : {}),
        ...(open ? {} : { inAt: now - p.returnedDaysAgo! * DAY, inBy: outBy }),
        ...(p.notes ? { notes: p.notes } : {}),
        ...(p.returnNotes ? { returnNotes: p.returnNotes } : {}),
        outBy,
        outByClerkUserId: TAG,
        // Stamped so the gear-overdue cron never sends an alert for demo rows.
        ...(overdue ? { overdueNotifiedAt: now } : {}),
      });
      checkouts++;
    }

    // ── staff payouts on recent completed sessions (commission basis) ──
    let payoutsAdded = 0;
    const paySessions = pastSessions.filter((s) => s.engineerId && s.endTime > now - 75 * DAY).slice(0, 16);
    for (let i = 0; i < paySessions.length; i++) {
      const s = paySessions[i];
      const existing = await ctx.db.query("payouts").withIndex("by_session", (q) => q.eq("sessionId", s._id)).first();
      if (existing) continue; // never a second payout on a session
      const pct = [20, 25, 30][i % 3];
      const amountCents = Math.round((s.rateCents * pct) / 100);
      if (amountCents <= 0) continue;
      const age = (now - s.endTime) / DAY;
      const status: Doc<"payouts">["status"] =
        i === 7 ? "void" : age > 28 ? "paid" : age > 12 ? "approved" : "queued";
      const createdAt = s.endTime + HOUR;
      await ctx.db.insert("payouts", {
        orgId,
        memberId: s.engineerId!,
        sessionId: s._id,
        basis: "commission",
        amountCents,
        explanation: `${pct}% of the $${(s.rateCents / 100).toFixed(2)} session rate`,
        status,
        sessionRateCents: s.rateCents,
        commissionPctSnapshot: pct,
        note: TAG,
        createdAt,
        ...(status === "approved" || status === "paid" ? { approvedAt: createdAt + 2 * DAY, approvedBy: owner?.clerkUserId ?? "system" } : {}),
        ...(status === "paid" ? { paidAt: createdAt + 9 * DAY, paidBy: owner?.clerkUserId ?? "system" } : {}),
      });
      payoutsAdded++;
    }

    // ── patch zones around the devices already on each canvas ──
    let groupsAdded = 0;
    const spaces = await ctx.db.query("patchSpaces").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const ZONES: { name: string; kind: string; color: string }[] = [
      { name: "Live room", kind: "liveRoom", color: "green" },
      { name: "Outboard rack", kind: "rack", color: "slate" },
      { name: "Console position", kind: "console", color: "blue" },
      { name: "Monitoring", kind: "monitoring", color: "violet" },
    ];
    for (const space of spaces.slice(0, 3)) {
      const existingGroups = await ctx.db.query("patchGroups").withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id)).first();
      if (existingGroups) continue; // the studio already drew its own zones here
      const devices = (await ctx.db.query("deviceInstances").withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id)).collect())
        .sort((a, b) => a.position.x - b.position.x);
      if (devices.length === 0) continue;
      const chunks = Math.min(3, Math.max(1, Math.ceil(devices.length / 3)));
      const per = Math.ceil(devices.length / chunks);
      for (let c = 0; c < chunks; c++) {
        const set = devices.slice(c * per, (c + 1) * per);
        if (set.length === 0) continue;
        const pad = 50;
        const minX = Math.min(...set.map((d) => d.position.x)) - pad;
        const minY = Math.min(...set.map((d) => d.position.y)) - pad - 30;
        const maxX = Math.max(...set.map((d) => d.position.x)) + 260 + pad;
        const maxY = Math.max(...set.map((d) => d.position.y)) + 180 + pad;
        const z = ZONES[(c + (space.roomId ? 0 : 1)) % ZONES.length];
        await ctx.db.insert("patchGroups", {
          orgId,
          patchSpaceId: space._id,
          name: z.name,
          kind: z.kind,
          ...(z.kind === "liveRoom" && space.roomId ? { roomId: space.roomId } : {}),
          color: z.color,
          position: { x: minX, y: minY },
          size: { width: Math.max(160, maxX - minX), height: Math.max(120, maxY - minY) },
          createdAt: now - (20 - c) * DAY,
          createdBy: TAG,
        });
        groupsAdded++;
      }
    }

    // ── package + membership revenue, only for real sales that have none yet ──
    let revenueAdded = 0;
    const credits = await ctx.db.query("packageCredits").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const c of credits.filter((x) => x.purchasedAt > now - 120 * DAY).slice(0, 6)) {
      const has = await ctx.db.query("revenueEntries").withIndex("by_org_source", (q) => q.eq("orgId", orgId).eq("sourceType", "package").eq("sourceId", c._id)).first();
      if (has) continue;
      await ctx.db.insert("revenueEntries", {
        orgId, sourceType: "package", sourceId: c._id, provider: "stripe",
        providerReference: `${TAG}_pkg_${c._id}`, incomeCategory: "packages_prepaid",
        amountCents: c.priceCents, currency: "USD", collectedAt: c.purchasedAt,
      });
      revenueAdded++;
    }
    const memberships = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const m of memberships.filter((x) => x.status === "active").slice(0, 2)) {
      const has = await ctx.db.query("revenueEntries").withIndex("by_org_source", (q) => q.eq("orgId", orgId).eq("sourceType", "membership").eq("sourceId", m._id)).first();
      if (has) continue;
      const plan = await ctx.db.get(m.planId);
      if (!plan || plan.priceCents <= 0) continue;
      for (let mo = 0; mo < 3; mo++) {
        const collectedAt = now - (mo * 30 + 3) * DAY;
        if (collectedAt < m.createdAt) continue;
        await ctx.db.insert("revenueEntries", {
          orgId, sourceType: "membership", sourceId: m._id, provider: "stripe",
          providerReference: `${TAG}_mem_${m._id}_${mo}`, incomeCategory: "memberships",
          amountCents: plan.priceCents, currency: "USD", collectedAt,
        });
        revenueAdded++;
      }
    }

    return { orgId, removed, checkouts, payoutsAdded, groupsAdded, revenueAdded };
  },
});

/* ─────────────────────────── fillB ─────────────────────────── */

const stripeFee = (cents: number) => Math.round(cents * 0.029) + 30;

export const fillB = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { orgId, nowMs }) => {
    const now = nowMs ?? Date.now();
    const org = await resolveOrg(ctx, orgId);
    const acct = org.stripeAccountId ?? `acct_${TAG}`;

    let removed = 0;
    for (const r of await ctx.db.query("stripeLedgerEntries").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (r.balanceTransactionId.startsWith(`txn_${TAG}_`)) { await ctx.db.delete(r._id); removed++; }
    }
    for (const r of await ctx.db.query("stripePayouts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (r.stripePayoutId.startsWith(`po_${TAG}_`)) { await ctx.db.delete(r._id); removed++; }
    }

    // Paid invoices settled online (card, or unrecorded on demo data) over the
    // last ~13 weeks. Every 4th is treated as paid outside Stripe. These rows
    // are clearing detail only: the P&L counts revenue from the invoice itself,
    // so nothing here is counted twice.
    const since = now - 91 * DAY;
    const paid = (await ctx.db.query("invoices").withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", since).lte("paidAt", now)).collect())
      .filter((i) => i.status === "paid" && (i.paymentMethod === "card" || i.paymentMethod === undefined) && i.amountCents > 0)
      .sort((a, b) => a.paidAt! - b.paidAt!)
      .filter((_, idx) => idx % 4 !== 3)
      .slice(-36);

    // Bucket charges into weekly payouts (Monday-start weeks, arrive Wednesday after).
    const weekStart = (ts: number) => {
      const d = new Date(utcDay(ts));
      return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
    };
    const weeks = new Map<number, typeof paid>();
    for (const inv of paid) {
      const w = weekStart(inv.paidAt!);
      weeks.set(w, [...(weeks.get(w) ?? []), inv]);
    }

    let entries = 0;
    let payouts = 0;
    let seq = 0;
    let refundDone = false;
    for (const [w, invs] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
      const arrival = w + 9 * DAY; // Wednesday of the following week
      const poId = `po_${TAG}_${dayKey(w).replace(/-/g, "")}`;
      let gross = 0, fee = 0, refund = 0, net = 0, count = 0;
      for (const inv of invs) {
        const f = stripeFee(inv.amountCents);
        await ctx.db.insert("stripeLedgerEntries", {
          orgId, stripeAccountId: acct,
          balanceTransactionId: `txn_${TAG}_${++seq}`,
          sourceId: `ch_${TAG}_${seq}`,
          payoutProviderId: poId,
          type: "charge", reportingCategory: "charge",
          grossCents: inv.amountCents, feeCents: f, netCents: inv.amountCents - f,
          currency: "USD", occurredAt: inv.paidAt!, availableAt: inv.paidAt! + 2 * DAY,
          description: `Invoice ${inv.number}`,
          revenueType: "invoice", revenueId: inv._id,
          importedAt: Math.min(now, arrival),
        });
        gross += inv.amountCents; fee += f; net += inv.amountCents - f; count++; entries++;
      }
      // One partial refund on an older week, so the refunds line is not empty.
      if (!refundDone && invs.length >= 2 && w < now - 30 * DAY) {
        const r = Math.min(5_000, Math.round(invs[0].amountCents / 4));
        await ctx.db.insert("stripeLedgerEntries", {
          orgId, stripeAccountId: acct,
          balanceTransactionId: `txn_${TAG}_${++seq}`,
          sourceId: `re_${TAG}_${seq}`,
          payoutProviderId: poId,
          type: "refund", reportingCategory: "refund",
          grossCents: -r, feeCents: 0, netCents: -r,
          currency: "USD", occurredAt: invs[0].paidAt! + DAY,
          description: `Partial refund on invoice ${invs[0].number}`,
          revenueType: "invoice", revenueId: invs[0]._id,
          importedAt: Math.min(now, arrival),
        });
        refund += r; net -= r; count++; entries++; refundDone = true;
      }
      const landed = arrival <= now;
      await ctx.db.insert("stripePayouts", {
        orgId, stripeAccountId: acct, stripePayoutId: poId,
        amountCents: net, currency: "USD",
        status: landed ? "paid" : "in_transit",
        method: "standard", arrivalDate: arrival,
        grossCents: gross, feeCents: fee, refundCents: refund, disputeCents: 0, adjustmentCents: 0, netCents: net,
        // Never "ready": that would let matchReadyPayouts touch real bank lines.
        // fillBank upgrades the landed ones to "matched" against its own deposits.
        reconciliationStatus: "pending",
        transactionCount: count,
        syncedAt: Math.min(now, arrival),
        createdAt: w + 7 * DAY,
      });
      payouts++;
    }
    return { orgId, removed, entries, payouts, invoicesUsed: paid.length, stripeAccountId: acct };
  },
});

/* ───────────────────────── fillBank (optional) ───────────────────────── */

export const fillBank = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { orgId, nowMs }) => {
    const now = nowMs ?? Date.now();
    await resolveOrg(ctx, orgId);
    const ITEM = `${TAG}_item`;

    let removed = 0;
    const myPayouts = (await ctx.db.query("stripePayouts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((p) => p.stripePayoutId.startsWith(`po_${TAG}_`));
    for (const conn of await ctx.db.query("bankConnections").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (conn.plaidItemId !== ITEM) continue;
      for (const t of await ctx.db.query("bankTransactions").withIndex("by_connection", (q) => q.eq("connectionId", conn._id)).collect()) {
        await ctx.db.delete(t._id); removed++;
      }
      for (const a of await ctx.db.query("bankAccounts").withIndex("by_connection", (q) => q.eq("connectionId", conn._id)).collect()) {
        await ctx.db.delete(a._id); removed++;
      }
      await ctx.db.delete(conn._id); removed++;
    }
    for (const p of myPayouts) if (p.bankTransactionId) await ctx.db.patch(p._id, { bankTransactionId: undefined, reconciliationStatus: "pending" });

    const owner = (await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).find((m) => m.role === "owner");
    const connectionId = await ctx.db.insert("bankConnections", {
      orgId, plaidItemId: ITEM, institutionName: "Chase", status: "active",
      // No token on purpose: the bank-sync cron skips a connection without one.
      lastSyncedAt: now - 2 * HOUR, connectedBy: owner?.clerkUserId, createdAt: now - 100 * DAY,
    });
    const checking = await ctx.db.insert("bankAccounts", {
      orgId, connectionId, plaidAccountId: `${TAG}_chk`, name: "Business Checking", officialName: "Chase Business Complete Checking",
      mask: "4821", type: "depository", subtype: "checking", currentCents: 4_862_350, availableCents: 4_810_000,
      currency: "USD", balanceAsOf: now - 2 * HOUR,
    });
    const card = await ctx.db.insert("bankAccounts", {
      orgId, connectionId, plaidAccountId: `${TAG}_card`, name: "Ink Business Card", mask: "1077",
      type: "credit", subtype: "credit card", currentCents: 312_440, limitCents: 2_500_000,
      currency: "USD", balanceAsOf: now - 2 * HOUR,
    });

    let seq = 0;
    let added = 0;
    const tx = async (f: Omit<Doc<"bankTransactions">, "_id" | "_creationTime" | "orgId" | "connectionId" | "plaidTransactionId" | "currency" | "updatedAt" | "pending"> & { pending?: boolean }) => {
      added++;
      return await ctx.db.insert("bankTransactions", {
        orgId, connectionId, plaidTransactionId: `${TAG}_${++seq}`, currency: "USD", updatedAt: now,
        pending: false, ...f,
      });
    };

    // Stripe payout deposits, reconciled to the payouts from fillB.
    let matched = 0;
    for (const p of myPayouts) {
      if (p.status !== "paid" || !p.arrivalDate || p.arrivalDate > now) continue;
      const id = await tx({
        accountId: checking, date: utcDay(p.arrivalDate), amountCents: p.amountCents, direction: "in",
        name: "STRIPE TRANSFER ST-" + p.stripePayoutId.slice(-8), merchantName: "Stripe",
        moneyInKind: "stripe_payout", stripePayoutId: p._id, reconciledAt: p.arrivalDate + HOUR,
      });
      await ctx.db.patch(p._id, { bankTransactionId: id, reconciliationStatus: "matched" });
      matched++;
    }

    // Outflows matched to the studio's own recurring expenses (last ~90 days).
    const expenses = (await ctx.db.query("expenses").withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", now - 90 * DAY).lte("date", now)).collect())
      .filter((e) => ["rent", "utilities", "insurance", "software", "marketing"].includes(e.category))
      .sort((a, b) => b.date - a.date)
      .slice(0, 14);
    for (const e of expenses) {
      const linked = await ctx.db.query("bankTransactions").withIndex("by_expense", (q) => q.eq("expenseId", e._id)).first();
      await tx({
        accountId: e.category === "marketing" || e.category === "software" ? card : checking,
        date: utcDay(e.date), amountCents: e.amountCents, direction: "out",
        name: (e.vendor ?? e.description ?? "Payment").toUpperCase(), merchantName: e.vendor ?? undefined,
        category: e.category,
        ...(linked ? {} : { expenseId: e._id, reconciledAt: e.date + DAY }),
      });
    }

    // A few lines still waiting on a person, so the review queue is not empty.
    await tx({ accountId: card, date: utcDay(now - 3 * DAY), amountCents: 18_999, direction: "out", name: "GUITAR CENTER #412", merchantName: "Guitar Center", category: "gear" });
    await tx({ accountId: card, date: utcDay(now - 5 * DAY), amountCents: 4_210, direction: "out", name: "UBER EATS", merchantName: "Uber Eats" });
    await tx({ accountId: checking, date: utcDay(now - 4 * DAY), amountCents: 45_000, direction: "in", name: "ZELLE FROM M. REYES" });
    await tx({ accountId: checking, date: utcDay(now - 12 * DAY), amountCents: 150_000, direction: "out", name: "PAYMENT TO CHASE CARD ENDING 1077", excluded: true, excludeReason: "card_payment" });
    await tx({ accountId: card, date: utcDay(now - 12 * DAY), amountCents: 150_000, direction: "in", name: "PAYMENT THANK YOU", moneyInKind: "internal_transfer", excluded: true, excludeReason: "card_payment" });
    await tx({ accountId: checking, date: utcDay(now), amountCents: 2_640, direction: "out", name: "SPOTIFY USA", merchantName: "Spotify", pending: true });

    return { orgId, removed, added, matchedPayouts: matched };
  },
});

/* ─────────────────────────── fillC ─────────────────────────── */

type Template = Doc<"socialPosts">["template"];

export const fillC = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { orgId, nowMs }) => {
    const now = nowMs ?? Date.now();
    await resolveOrg(ctx, orgId);

    let removed = 0;
    const posts = await ctx.db.query("socialPosts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const p of posts) if (p.submittedBy === TAG) { await ctx.db.delete(p._id); removed++; }
    for (const p of await ctx.db.query("promos").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (p.createdBy === TAG) { await ctx.db.delete(p._id); removed++; }
    }
    for (const step of ["page", "booked"] as const) {
      for (const r of await ctx.db.query("bookingVisits").withIndex("by_org_step", (q) => q.eq("orgId", orgId).eq("step", step)).collect()) {
        if (r.visitorKey.startsWith(`${TAG}_`)) { await ctx.db.delete(r._id); removed++; }
      }
    }

    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const accounts = (await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((a) => a.status === "connected").slice(0, 2).map((a) => a._id);
    const approver = members.find((m) => m.role === "owner")?.name ?? "Studio owner";
    const room = rooms[0];
    const roomName = room?.name ?? "Studio A";
    const artist = (i: number) => artists.length ? artists[i % artists.length] : null;
    const aName = (i: number) => artist(i)?.name ?? "a returning client";
    const eng = members.find((m) => m.role === "engineer")?.name ?? "our lead engineer";

    // ── promos (skip a code the studio already uses) ──
    const taken = new Set((await ctx.db.query("promos").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).map((p) => p.code));
    const PROMOS: { code: string; pct: number; label: string; startDays: number; endDays: number; active: boolean; redemptions: number; max?: number; source: "owner" | "rate_cut"; room?: boolean }[] = [
      { code: "SUMMERVOX", pct: 15, label: "Summer vocal sessions", startDays: -80, endDays: -35, active: false, redemptions: 14, max: 20, source: "owner" },
      { code: "MIXWEEK", pct: 10, label: "Mix week, 10% off mixing", startDays: -6, endDays: 8, active: true, redemptions: 6, max: 25, source: "owner" },
      { code: "LATENIGHT20", pct: 20, label: "Late night block in " + roomName, startDays: -10, endDays: 18, active: true, redemptions: 3, source: "rate_cut", room: true },
      { code: "HOLIDAY25", pct: 25, label: "Holiday gift sessions", startDays: 21, endDays: 60, active: true, redemptions: 0, max: 40, source: "owner" },
    ];
    const promoIds: Id<"promos">[] = [];
    for (const p of PROMOS) {
      const code = taken.has(p.code) ? `${p.code}2` : p.code;
      if (taken.has(code)) continue;
      promoIds.push(await ctx.db.insert("promos", {
        orgId, code, pct: p.pct, label: p.label, startsAt: now + p.startDays * DAY, endsAt: now + p.endDays * DAY,
        ...(p.room && room ? { roomId: room._id } : {}),
        ...(p.max ? { maxRedemptions: p.max } : {}),
        redemptions: p.redemptions, source: p.source, active: p.active, createdBy: TAG,
        createdAt: now + Math.min(p.startDays - 3, -1) * DAY,
      }));
    }

    // ── social posts: 8 published, 4 scheduled, 3 drafts ──
    type P = { t: Template; days: number; status: "published" | "scheduled" | "draft"; caption: string; type: "post" | "reel" | "story"; card?: "rate_card" | "open_slot" | "promo"; promo?: number; artistIdx?: number; imp?: number; eng?: number; clicks?: number; booked?: number };
    const PLAN: P[] = [
      { t: "session_bts", days: -52, status: "published", type: "reel", artistIdx: 0, caption: `Late night in ${roomName} with ${aName(0)}. Three vocal takes, one keeper.`, imp: 18_400, eng: 1_240, clicks: 5, booked: 1 },
      { t: "rate_promo", days: -45, status: "published", type: "post", card: "promo", promo: 0, caption: "Summer vocal sessions are 15% off with code SUMMERVOX. Book through the link in bio.", imp: 6_900, eng: 310, clicks: 4, booked: 2 },
      { t: "client_win", days: -38, status: "published", type: "post", artistIdx: 1, caption: `Congrats to ${aName(1)} on the new single. Tracked, mixed and mastered right here.`, imp: 24_100, eng: 2_870, clicks: 3 },
      { t: "room_gear", days: -30, status: "published", type: "reel", caption: `A quick tour of the vocal chain in ${roomName}. Ask us what is on the rack.`, imp: 9_300, eng: 640, clicks: 2 },
      { t: "tip", days: -22, status: "published", type: "post", caption: "Studio tip: bring reference tracks on your phone. It saves an hour of guessing.", imp: 4_200, eng: 220 },
      { t: "engineer_story", days: -15, status: "published", type: "reel", caption: `Meet ${eng}. Ten years behind the desk and still the first one in.`, imp: 11_800, eng: 905, clicks: 2 },
      { t: "rate_promo", days: -5, status: "published", type: "post", card: "promo", promo: 1, caption: "It is mix week. 10% off every mix booked before Sunday with code MIXWEEK.", imp: 5_100, eng: 260, clicks: 4, booked: 2 },
      { t: "before_after", days: -2, status: "published", type: "reel", artistIdx: 2, caption: `Rough mix vs final for ${aName(2)}. Turn your sound up for this one.`, imp: 7_600, eng: 815, clicks: 3, booked: 1 },
      { t: "open_slot", days: 1, status: "scheduled", type: "story", card: "open_slot", caption: `${roomName} just opened up Thursday night. First to book gets it.` },
      { t: "session_bts", days: 3, status: "scheduled", type: "reel", artistIdx: 3, caption: `Day two with ${aName(3)}. Drums are done, bass goes down tonight.` },
      { t: "rate_promo", days: 6, status: "scheduled", type: "post", card: "rate_card", promo: 2, caption: "Late night block rates are live. 20% off after 10pm with code LATENIGHT20." },
      { t: "tip", days: 9, status: "scheduled", type: "post", caption: "Print your lyrics before the session. Your engineer will thank you." },
      { t: "client_win", days: 12, status: "scheduled", type: "post", artistIdx: 4, caption: `${aName(4)} wrapped the EP this week. Release date coming soon.` },
      { t: "custom", days: 16, status: "scheduled", type: "post", card: "promo", promo: 3, caption: "Give the gift of studio time. Holiday sessions are 25% off with HOLIDAY25." },
      { t: "room_gear", days: 20, status: "scheduled", type: "reel", caption: "New in the mic locker. Come hear it before anyone else does." },
    ];
    let postsAdded = 0;
    let visits = 0;
    for (let i = 0; i < PLAN.length; i++) {
      const p = PLAN[i];
      const at = now + p.days * DAY + ((i * 37) % 9) * HOUR;
      const a = p.artistIdx !== undefined ? artist(p.artistIdx) : null;
      const promoId = p.promo !== undefined ? promoIds[p.promo] : undefined;
      const id = await ctx.db.insert("socialPosts", {
        orgId, template: p.t, status: p.status, caption: p.caption,
        media: p.card ? [{ brandCard: p.card, type: "image" as const }] : [],
        accountIds: accounts, scheduledFor: at, timezone: "America/Los_Angeles",
        ...(promoId ? { promoId } : {}),
        ...(a ? { artistId: a._id } : {}),
        ...(room ? { roomId: room._id } : {}),
        // Simulated id: the status cron only flips it to published in the DB.
        ...(p.status !== "draft" ? { ghlPostId: `simulated:${TAG}-${i}` } : {}),
        ghlType: p.type, submittedBy: TAG,
        ...(p.status !== "draft" ? { approvedBy: approver, approvedAt: at - 2 * DAY } : {}),
        ...(p.status === "published" ? {
          publishedAt: at,
          stats: { impressions: p.imp, engagements: p.eng, refreshedAt: now - 6 * HOUR },
        } : {}),
        createdAt: at - 3 * DAY, updatedAt: p.status === "published" ? at : now - DAY,
      });
      postsAdded++;
      if (p.status !== "published") continue;
      const code = promoId ? (await ctx.db.get(promoId))?.code : undefined;
      for (let c = 0; c < (p.clicks ?? 0); c++) {
        const t = Math.min(now, at + (c + 1) * 5 * HOUR);
        await ctx.db.insert("bookingVisits", {
          orgId, visitorKey: `${TAG}_${i}_${c}`, step: "page", day: dayKey(t),
          postId: id, ...(code ? { code } : {}), utmSource: "social", createdAt: t,
        });
        visits++;
      }
      for (let b = 0; b < (p.booked ?? 0); b++) {
        const t = Math.min(now, at + (b + 1) * 20 * HOUR);
        await ctx.db.insert("bookingVisits", {
          orgId, visitorKey: `${TAG}_${i}_${b}`, step: "booked", day: dayKey(t),
          ...(room ? { roomId: room._id } : {}),
          amountCents: [24_000, 32_000, 18_000][b % 3],
          postId: id, ...(code ? { code } : {}), utmSource: "social", createdAt: t,
        });
        visits++;
      }
    }
    return { orgId, removed, promos: promoIds.length, postsAdded, visits, accountsLinked: accounts.length };
  },
});

/* ─────────────────────────── fillD ─────────────────────────── */

const MARK = ` ${TAG}`;

export const fillD = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { orgId, nowMs }) => {
    const now = nowMs ?? Date.now();
    await resolveOrg(ctx, orgId);

    let removed = 0;
    for (const a of await ctx.db.query("mediaAssets").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if (!a.searchText.endsWith(MARK)) continue;
      // Cascade only through our own rows. The mediaFiles row is NOT ours and is never deleted.
      for (const ver of await ctx.db.query("mediaVersions").withIndex("by_asset", (q) => q.eq("assetId", a._id)).collect()) {
        for (const n of await ctx.db.query("mediaNotes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) {
          await ctx.db.delete(n._id); removed++;
        }
        await ctx.db.delete(ver._id); removed++;
      }
      for (const e of await ctx.db.query("mediaEvents").withIndex("by_asset", (q) => q.eq("assetId", a._id)).collect()) {
        await ctx.db.delete(e._id); removed++;
      }
      await ctx.db.delete(a._id); removed++;
    }

    // Existing, finished, attached files of this studio that no library
    // version or deliverable already points at. No bytes are invented.
    const files = await ctx.db.query("mediaFiles").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const deliverables = await ctx.db.query("deliverables").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const usedByDeliverable = new Set(deliverables.map((d) => d.fileId as string | undefined).filter(Boolean) as string[]);
    const candidates: Doc<"mediaFiles">[] = [];
    for (const f of files) {
      if (f.status !== "ready" || !f.attachedAt) continue;
      if (f.purpose !== "deliverable" && f.purpose !== "cover") continue;
      if (usedByDeliverable.has(f._id)) continue;
      if (await ctx.db.query("mediaVersions").withIndex("by_media", (q) => q.eq("mediaId", f._id)).first()) continue;
      candidates.push(f);
    }
    if (candidates.length === 0) return { orgId, removed, assets: 0, skipped: "no free deliverable or cover files in this org" };
    const audio = candidates.filter((f) => !f.mimeType.startsWith("image/"));
    const images = candidates.filter((f) => f.mimeType.startsWith("image/"));

    const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(20);
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const who = (i: number) => members.length ? members[i % members.length].name : "Studio";
    const artistName = async (s: Doc<"songs"> | undefined) => (s ? (await ctx.db.get(s.artistId))?.name ?? null : null);

    const PLAN: { label: string; kind: Doc<"mediaAssets">["kind"]; versions: number; tags: string[]; image?: boolean }[] = [
      { label: "Final master", kind: "master", versions: 3, tags: ["final", "streaming"] },
      { label: "Mix", kind: "mix", versions: 2, tags: ["mix", "review"] },
      { label: "Vocal stems", kind: "stem", versions: 1, tags: ["stems"] },
      { label: "Cover art", kind: "artwork", versions: 2, tags: ["artwork", "release"], image: true },
      { label: "Session export", kind: "session", versions: 1, tags: ["pro tools"] },
      { label: "Radio edit", kind: "deliverable", versions: 1, tags: ["radio", "clean"] },
    ];
    const NOTES = [
      "Vocal sits a touch hot in the second chorus. Pull it back 1 dB.",
      "Low end is perfect now. Approved from our side.",
      "Can we get a version with the ad libs muted?",
      "Louder than v1, still breathing. Love it.",
      "Kick feels buried on phone speakers.",
    ];

    let assets = 0, versions = 0, notes = 0, events = 0;
    let ai = 0, ii = 0;
    for (let p = 0; p < PLAN.length; p++) {
      const plan = PLAN[p];
      const pool = plan.image ? images : audio;
      let idx = plan.image ? ii : ai;
      const take = Math.min(plan.versions, pool.length - idx);
      if (take <= 0) continue;
      const song = songs.length ? songs[p % songs.length] : undefined;
      const by = await artistName(song);
      const name = song ? `${song.title} - ${plan.label}` : plan.label;
      const createdAt = now - (40 - p * 5) * DAY;
      const searchText = [name, ...plan.tags, plan.kind, song?.title ?? "", by ?? ""].join(" ").toLowerCase() + MARK;
      const assetId = await ctx.db.insert("mediaAssets", {
        orgId, name, kind: plan.kind, tags: plan.tags, ...(song ? { songId: song._id } : {}),
        currentVersion: 0, versionCount: 0, totalBytes: 0, searchText,
        createdBy: who(p), createdAt, updatedAt: createdAt,
      });
      assets++;
      let total = 0;
      let last = createdAt;
      for (let k = 0; k < take; k++) {
        const f = pool[idx++];
        const at = createdAt + k * 4 * DAY + p * HOUR;
        const latest = k === take - 1;
        const approval: Doc<"mediaVersions">["approval"] = latest ? (p % 2 === 0 ? "approved" : "pending") : "changes_requested";
        const verId = await ctx.db.insert("mediaVersions", {
          orgId, assetId, version: k + 1, mediaId: f._id, fileName: f.fileName, size: f.size ?? 0, mimeType: f.mimeType,
          note: k === 0 ? "First pass" : `Revision ${k} after notes`,
          approval,
          ...(approval !== "pending" ? { approvedBy: by ?? who(p + 1), approvedAt: at + DAY } : {}),
          uploadedBy: who(p + k), uploadedAt: at,
        });
        versions++;
        total += f.size ?? 0;
        last = at;
        await ctx.db.insert("mediaEvents", { orgId, assetId, version: k + 1, action: "upload", actor: who(p + k), detail: f.fileName, createdAt: at });
        events++;
        if (approval !== "pending") {
          await ctx.db.insert("mediaEvents", { orgId, assetId, version: k + 1, action: approval, actor: by ?? who(p + 1), createdAt: at + DAY });
          events++;
        }
        if (approval !== "approved" || k > 0) {
          await ctx.db.insert("mediaNotes", { orgId, versionId: verId, body: NOTES[(p + k) % NOTES.length], author: by ?? who(p + 1), createdAt: at + 20 * HOUR });
          notes++;
        }
      }
      if (plan.image) ii = idx; else ai = idx;
      await ctx.db.patch(assetId, { currentVersion: take, versionCount: take, totalBytes: total, updatedAt: last });
    }
    return { orgId, removed, assets, versions, notes, events, filesAvailable: candidates.length };
  },
});
