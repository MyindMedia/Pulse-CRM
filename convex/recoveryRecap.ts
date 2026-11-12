import { internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { notifyTeam } from "./lib/notify";
import { stripEmDashes } from "./lib/text";
import { feeKindOf } from "./lib/recoveryOnPaid";

/* ============================================================
   Monthly "Recovered by Pulse" recap email.

   Once a month the cron fires runMonthly, which fans a per-org
   recap across every active subaccount. Each org's owner gets a
   short "Pulse recovered $X for you last month" note with a
   by-kind breakdown - the renewal-proof number, delivered to the
   inbox. Orgs with nothing recovered and no unpaid fees are
   skipped, and a lightweight
   notifications-log guard keeps it from double-sending within a
   month even if the fan-out is retriggered.
   ============================================================ */

const LABELS: Record<string, string> = {
  deposit_forfeited: "Forfeited deposits",
  cancellation_fee: "Late-cancel fees",
  no_show_fee: "No-show fees",
  reminder_collected: "Reminder-driven payments",
};

const RECAP_KIND = "recovery.recap";

/** Invoice statuses that still owe money. */
const UNPAID_STATUSES = ["draft", "sent", "viewed", "overdue"] as const;
/** Bound per status for the open-fee scan. */
const UNPAID_SCAN = 500;

/** "a", "a and b", "a, b and c", in plain words for the recap sentence. */
function listKinds(kinds: string[]): string {
  const words = kinds.map((k) => (LABELS[k] ?? k).toLowerCase());
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Cents -> "$1,234" (whole dollars, thousands separated). */
function fmtCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** Build the month label, e.g. "June 2026", from a period-start timestamp. */
function monthLabel(periodStart: number): string {
  return new Date(periodStart).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Recap one org's recovered dollars for a closed month and email the owner.
 *  Idempotent: skips if nothing was recovered and no fee is waiting, or a
 *  recap for this run was already sent. */
export const recapForOrg = internalMutation({
  args: {
    orgId: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, { orgId, periodStart, periodEnd }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org?.ownerEmail) return { sent: false, reason: "no_owner_email" };

    // Recovered events inside the closed month, via the [orgId, at] index.
    const events = await ctx.db
      .query("recoveryEvents")
      .withIndex("by_org_at", (q) =>
        q.eq("orgId", orgId).gte("at", periodStart).lt("at", periodEnd),
      )
      .collect();

    // A late-cancel or no-show fee counts as recovered when its invoice is
    // paid: lib/recoveryOnPaid.ts writes (or, for a fee logged at billing
    // before that change, re-dates) the event at the paid time, so a fee paid
    // a month after it was billed lands in the month it was paid. A legacy
    // fee event whose invoice is still unpaid is listed as waiting, and one
    // settled with studio credit is not counted.
    let totalCents = 0;
    let pendingCents = 0;
    const pendingInvoices = new Set<string>();
    const byKindMap = new Map<string, number>();
    for (const e of events) {
      if (e.kind === "no_show_fee" || e.kind === "cancellation_fee") {
        const inv = e.invoiceId ? await ctx.db.get(e.invoiceId) : null;
        if (inv?.status !== "paid") {
          if (inv && inv.status !== "void" && !pendingInvoices.has(inv._id)) {
            pendingInvoices.add(inv._id);
            pendingCents += e.amountCents;
          }
          continue;
        }
        // Settled with studio credit: no money came in.
        if (inv.paymentMethod === "credit") continue;
      }
      totalCents += e.amountCents;
      byKindMap.set(e.kind, (byKindMap.get(e.kind) ?? 0) + e.amountCents);
    }

    // Fees billed this month and not paid yet have no event (nothing is
    // recorded until payment), so read them from the open fee invoices.
    for (const status of UNPAID_STATUSES) {
      const open = await ctx.db
        .query("invoices")
        .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .order("desc")
        .take(UNPAID_SCAN);
      for (const inv of open) {
        if (inv._creationTime < periodStart || inv._creationTime >= periodEnd) continue;
        if (!feeKindOf(inv) || pendingInvoices.has(inv._id)) continue;
        pendingInvoices.add(inv._id);
        pendingCents += inv.amountCents;
      }
    }

    // Nothing won back and nothing waiting: no email. Unpaid fees alone still
    // send one, because that is exactly when the owner needs to follow up.
    if (totalCents <= 0 && pendingCents <= 0) return { sent: false, reason: "nothing_recovered" };

    // Idempotency guard: bail if a recap notification for this org was already
    // written since the month closed (i.e. within this run's window onward).
    const priorRecaps = await ctx.db
      .query("notifications")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const alreadySent = priorRecaps.some(
      (n) => n.kind === RECAP_KIND && n._creationTime >= periodEnd,
    );
    if (alreadySent) return { sent: false, reason: "already_sent" };

    const label = monthLabel(periodStart);
    const breakdown = [...byKindMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, cents]) => `- ${LABELS[kind] ?? kind}: ${fmtCents(cents)}`)
      .join("\n");

    const greetingName = org.ownerName ? ` ${org.ownerName.split(" ")[0]}` : "";
    const studio = org.name ?? "your studio";
    const pendingLine = `Not collected yet: ${fmtCents(pendingCents)} in late-cancel and no-show fees is on invoices that are not paid. Open Payments in Pulse to send them or follow up.`;
    const body = stripEmDashes(
      totalCents > 0
        ? `Hi${greetingName},

Pulse recovered ${fmtCents(totalCents)} for ${studio} in ${label}.

That is money kept or collected from ${listKinds([...byKindMap.keys()])}, dollars that would otherwise have walked out the door.

Breakdown for ${label}:
${breakdown}

${
  pendingCents > 0
    ? pendingLine
    : "No action needed. Pulse keeps working in the background so the subscription pays for itself."
}

- The Pulse team`
        : `Hi${greetingName},

Nothing was collected yet for ${studio} in ${label}.

${pendingLine}

- The Pulse team`,
    );

    await notifyTeam(ctx, {
      orgId,
      subject: stripEmDashes(
        totalCents > 0
          ? `Pulse recovered ${fmtCents(totalCents)} for you in ${label}`
          : `${fmtCents(pendingCents)} in fees still to collect from ${label}`,
      ),
      body,
      kind: RECAP_KIND,
    });

    return { sent: true, totalCents };
  },
});

/** Cron entry point: fan the recap across every active subaccount for the
 *  month that just closed. Runs on the 1st, so "last month" is the prior
 *  calendar month. Skips the seeded demo org and inactive subaccounts. */
export const runMonthly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const d = new Date(now);
    const periodStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const periodEnd = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

    const orgs = await ctx.db.query("orgs").collect();
    const ids = orgs
      .filter((o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo")
      .map((o) => o.orgId);

    for (const orgId of ids) {
      await ctx.scheduler.runAfter(0, internal.recoveryRecap.recapForOrg, {
        orgId,
        periodStart,
        periodEnd,
      });
    }
    return { scheduled: ids.length, periodStart, periodEnd };
  },
});
