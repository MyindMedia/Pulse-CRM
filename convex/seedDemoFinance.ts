import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { memberPay } from "./lib/payroll";

/* ============================================================
   Demo finance fill - the money-OUT + payroll side of the pitch
   demo (revenue already exists from seedDemoYear). Loads:
     - pay on every team member: managers + senior engineers are
       FULL-TIME salaried, the first engineer is hourly/part-time,
     - ~12 months of expenses (rent, utilities, insurance, ad
       spend, gear, repairs, fees) so the P&L has a real cost
       base and net profit,
     - ~8 weeks of clocked time entries for the WHOLE paid team
       on a steady weekly rhythm (so the Payroll page shows the
       full roster with hours in any pay period), one engineer
       currently ON the clock, a live shift for the owner so the
       mobile clock-in widget pops the moment they log in, and
       the org's pay-period preference (biweekly, mid-period).
   Idempotent: every row it creates is tagged; a re-run wipes the
   tagged rows first, so real data is never touched.
     npx convex run seedDemoFinance:fill '{}'            (auto-finds Myind Sound)
     npx convex run seedDemoFinance:fill '{"orgId":"…"}'
   ============================================================ */

const TAG = "[demo_finance]";
const DAY = 86_400_000;
const HOUR = 3_600_000;

type Cat =
  | "rent" | "utilities" | "software" | "gear" | "repairs" | "payroll"
  | "contractor" | "marketing" | "supplies" | "insurance" | "travel" | "fees" | "other";

// Hourly pay by role (cents/hour). The owner draws profit rather than
// payroll, so they're omitted. Roles that become FULL-TIME (see SALARY
// below) get a salary instead of their hourly rate.
const PAY: Record<string, ["hourly" | "salary", number]> = {
  manager: ["hourly", 3_000],
  producer: ["hourly", 4_200],
  engineer: ["hourly", 3_200],
  assistant_engineer: ["hourly", 1_900],
  artist_relations: ["hourly", 2_100],
  accountant: ["hourly", 3_500],
  intern: ["hourly", 1_500],
};

// Full-time staff: BOTH managers and the senior engineers are salaried
// employees (ANNUAL cents, prorated per pay period by lib/payroll). The
// first engineer stays hourly/part-time so the demo shows both pay types
// and the live on-the-clock ticker still moves the pay number.
const SALARY = {
  manager: 5_200_000, // $52k/yr studio managers
  engineer: 4_750_000, // $47.5k/yr senior engineers
};

// Fixed monthly costs (created for each of the last 12 months). Sized for a
// small studio so the P&L reads as a healthy, modestly profitable business.
const FIXED: { category: Cat; vendor: string; label: string; cents: number }[] = [
  { category: "rent", vendor: "Eastside Property Mgmt", label: "Studio rent", cents: 120_000 },
  { category: "utilities", vendor: "City Power & Water", label: "Utilities", cents: 16_000 },
  { category: "utilities", vendor: "Fiber ISP", label: "Internet & phone", cents: 8_000 },
  { category: "insurance", vendor: "Hiscox", label: "Business insurance", cents: 8_500 },
  { category: "marketing", vendor: "Meta / Google Ads", label: "Ad spend", cents: 10_000 },
  { category: "supplies", vendor: "Studio Supply Co", label: "Consumables & supplies", cents: 5_500 },
  { category: "fees", vendor: "Stripe", label: "Payment processing", cents: 12_000 },
];

// One-off costs scattered across the year.
const ONE_OFFS: { category: Cat; vendor: string; label: string; cents: number; daysAgo: number }[] = [
  { category: "gear", vendor: "Sweetwater", label: "Audient interface", cents: 78_000, daysAgo: 40 },
  { category: "gear", vendor: "Sweetwater", label: "KRK monitors (pair)", cents: 52_000, daysAgo: 120 },
  { category: "gear", vendor: "Vintage King", label: "Shure SM7B + cloudlifter", cents: 48_000, daysAgo: 205 },
  { category: "repairs", vendor: "Pro Audio Service", label: "Mic capsule repair", cents: 22_000, daysAgo: 70 },
  { category: "repairs", vendor: "Cool Air HVAC", label: "HVAC service call", cents: 26_000, daysAgo: 150 },
  { category: "marketing", vendor: "Northlight Studio", label: "Brand photoshoot", cents: 35_000, daysAgo: 90 },
  { category: "fees", vendor: "Berkman CPA", label: "Annual bookkeeping", cents: 45_000, daysAgo: 30 },
  { category: "software", vendor: "Avid", label: "Pro Tools renewal", cents: 29_900, daysAgo: 60 },
  { category: "contractor", vendor: "Freelance Mixer", label: "Overflow mix work", cents: 38_000, daysAgo: 35 },
];

export const fill = internalMutation({
  args: { orgId: v.optional(v.string()), nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now();
    let orgId = args.orgId;
    if (!orgId) {
      const orgs = await ctx.db.query("orgs").collect();
      orgId = orgs.find((o) => /myind/i.test(o.name))?.orgId;
    }
    if (!orgId) throw new Error("Pass orgId; could not auto-find the Myind Sound demo org.");

    // ── Idempotency: wipe previously-tagged demo rows. ──
    let removed = 0;
    for (const e of await ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if ((e.notes ?? "").endsWith(TAG)) { await ctx.db.delete(e._id); removed++; }
    }
    for (const t of await ctx.db.query("timeEntries").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if ((t.note ?? "").endsWith(TAG)) { await ctx.db.delete(t._id); removed++; }
    }
    for (const s of await ctx.db.query("shifts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) {
      if ((s.note ?? "").endsWith(TAG)) { await ctx.db.delete(s._id); removed++; }
    }

    // ── Pay on every member (idempotent re-set). Managers + all but the
    //    first engineer are FULL-TIME salaried; the first engineer stays
    //    hourly/part-time. Each member's final plan is kept so the time
    //    entries below can match snapshot rates + shift length to it. ──
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    let paid = 0;
    const plan = new Map<string, { payType: "hourly" | "salary"; rateCents: number }>();
    let hourlyEngineerId: string | null = null;
    for (const m of members) {
      const p = PAY[m.role];
      if (p) {
        let payType = p[0];
        let rateCents = p[1];
        if (m.role === "manager") {
          payType = "salary";
          rateCents = SALARY.manager;
        } else if (m.role === "engineer") {
          if (hourlyEngineerId === null) {
            hourlyEngineerId = m._id; // stays hourly (the on-the-clock demo engineer)
          } else {
            payType = "salary";
            rateCents = SALARY.engineer;
          }
        }
        await ctx.db.patch(m._id, { payType, payRateCents: rateCents });
        plan.set(m._id, { payType, rateCents });
        paid++;
      } else {
        // Roles not in PAY (e.g. the owner, who draws profit) are unpaid - clear
        // any stale pay so re-runs don't leave an old rate on the books.
        await ctx.db.patch(m._id, { payType: undefined, payRateCents: undefined });
      }
    }

    // ── Expenses: 12 months of fixed costs + one-offs. ──
    let expensesAdded = 0;
    for (let mo = 0; mo < 12; mo++) {
      const d = new Date(now);
      const monthDate = new Date(d.getFullYear(), d.getMonth() - mo, 5, 12).getTime();
      const recurring = mo === 0 ? ("monthly" as const) : undefined; // only current month flags run-rate
      for (const f of FIXED) {
        await ctx.db.insert("expenses", {
          orgId, category: f.category, vendor: f.vendor, description: f.label,
          amountCents: f.cents, date: monthDate, recurring, notes: `${f.label} ${TAG}`,
        });
        expensesAdded++;
      }
    }
    for (const o of ONE_OFFS) {
      await ctx.db.insert("expenses", {
        orgId, category: o.category, vendor: o.vendor, description: o.label,
        amountCents: o.cents, date: now - o.daysAgo * DAY, notes: `${o.label} ${TAG}`,
      });
      expensesAdded++;
    }

    // ── Time entries: ~8 weeks of clocked hours for the WHOLE paid team.
    //    Full-timers (salaried) work Mon-Fri 7-8h days; the hourly engineer
    //    keeps a part-time rhythm of two 3-4h shifts a week. So any window -
    //    this month, or the current biweekly/monthly pay period - shows the
    //    full roster with hours that match their employment type.
    let entriesAdded = 0;
    const payable = members.filter((m) => plan.has(m._id));
    for (let i = 0; i < payable.length; i++) {
      const m = payable[i];
      const p = plan.get(m._id)!;
      const fullTime = p.payType === "salary";
      const isManager = m.role === "manager";
      // Weekdays this teammate clocks in (1=Mon..5=Fri, part-timers staggered).
      const workdays = fullTime ? [1, 2, 3, 4, 5] : [1 + (i % 3), 4 + (i % 3)];
      for (let off = 1; off <= 56; off++) {
        const day = new Date(now - off * DAY);
        if (!workdays.includes(day.getDay())) continue;
        const inAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), isManager ? 9 : fullTime ? 10 : 11, 0).getTime();
        const hours = fullTime ? 7 + ((i + off) % 2) : 3 + ((i + off) % 2); // full-timers 7-8h, part-time 3-4h
        await ctx.db.insert("timeEntries", {
          orgId, memberId: m._id, clockInAt: inAt, clockOutAt: inAt + hours * HOUR,
          status: "completed",
          rateCentsSnapshot: p.payType === "hourly" ? p.rateCents : undefined,
          source: "self", note: TAG,
        });
        entriesAdded++;
      }
    }

    // ── The hourly engineer currently ON the clock (live ticking pay). ──
    const eng = payable.find((m) => m._id === hourlyEngineerId) ?? payable.find((m) => m.role === "engineer");
    if (eng) {
      await ctx.db.insert("timeEntries", {
        orgId, memberId: eng._id, clockInAt: now - 2 * HOUR, status: "active",
        rateCentsSnapshot: plan.get(eng._id)!.payType === "hourly" ? plan.get(eng._id)!.rateCents : undefined,
        source: "self", note: TAG,
      });
      entriesAdded++;
    }

    // ── Live shift for the owner so the clock-in widget pops on login. ──
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (owner) {
      await ctx.db.insert("shifts", {
        orgId, memberId: owner._id, startTime: now - 10 * 60_000, endTime: now + 4 * HOUR,
        kind: "scheduled", status: "scheduled", note: `Front desk ${TAG}`,
      });
    }

    // ── Pay-period preference: the demo studio pays every two weeks,
    //    anchored to the Monday of LAST week so "today" sits mid-period.
    const orgRow = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (orgRow) {
      const d = new Date(now);
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) - 7);
      const anchor = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
      await ctx.db.patch(orgRow._id, { payrollSchedule: "biweekly", payrollAnchorDate: anchor });
    }

    return { orgId, removed, paid, expensesAdded, entriesAdded };
  },
});

/** Verification helper: the demo org's P&L + payroll snapshot (last 12 months /
 *  last 8 weeks), so we can confirm the seeded numbers read like a real studio.
 *  Internal-only - run with `npx convex run seedDemoFinance:check '{}'`. */
export const check = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let orgId = args.orgId;
    if (!orgId) {
      const orgs = await ctx.db.query("orgs").collect();
      orgId = orgs.find((o) => /myind/i.test(o.name))?.orgId;
    }
    if (!orgId) throw new Error("org not found");
    const now = Date.now();
    const yearAgo = now - 365 * DAY;

    const invoices = await ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId!)).collect();
    const paidInv = invoices.filter((i) => i.status === "paid" && i.paidAt && i.paidAt >= yearAgo);
    const invoiceRevenue = paidInv.reduce((s, i) => s + i.amountCents, 0);
    const invSessions = new Set(paidInv.map((i) => i.sessionId).filter(Boolean));
    const payments = await ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId!)).collect();
    const paymentRevenue = payments
      .filter((p) => p.status === "paid" && (p.paidAt ?? p._creationTime) >= yearAgo && !invSessions.has(p.sessionId))
      .reduce((s, p) => s + p.amountCents, 0);
    const revenueCents = invoiceRevenue + paymentRevenue;

    const expenses = await ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("orgId", orgId!)).collect();
    const expensesCents = expenses.filter((e) => e.date >= yearAgo).reduce((s, e) => s + e.amountCents, 0);

    const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId!)).collect();
    const sessionCollected = sessions
      .filter((s) => s.startTime >= yearAgo && s.startTime <= now)
      .reduce((s2, s) => s2 + (s.amountPaidCents ?? 0), 0);

    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId!)).collect();
    const entries = await ctx.db.query("timeEntries").withIndex("by_org", (q) => q.eq("orgId", orgId!)).collect();
    let payrollHours = 0;
    let payrollPayCents = 0;
    for (const m of members) {
      const es = entries.filter((e) => e.memberId === m._id);
      const { hours, payCents } = memberPay(
        es.map((e) => ({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, rateCentsSnapshot: e.rateCentsSnapshot })),
        { payType: m.payType, payRateCents: m.payRateCents },
        now,
        56 * DAY,
      );
      payrollHours += hours;
      payrollPayCents += payCents;
    }

    const usd = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
    return {
      revenueViaInvoices12mo: usd(revenueCents),
      revenueViaSessionsPaid12mo: usd(sessionCollected),
      expenses12mo: usd(expensesCents),
      netUsingSessionsPaid: usd(sessionCollected - expensesCents),
      paidInvoices: paidInv.length,
      payrollHours8wk: Math.round(payrollHours),
      payroll8wk: usd(payrollPayCents),
      timeEntries: entries.length,
    };
  },
});
