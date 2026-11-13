"use client";

import { EntityLink } from "@/components/shell/entity-link";
import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Wallet, Clock, Users, ArrowRightLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatTile } from "@/components/ui/stat-tile";
import { CountUp } from "@/components/shell/app-motion";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { money } from "@/lib/format";
import { SetPayDialog, type PayTarget } from "@/components/payroll/set-pay-dialog";
import { PayoutsPanel } from "@/components/payroll/payouts-panel";
import { TimesheetPanel } from "@/components/payroll/timesheet-panel";
import { useCapabilities } from "@/lib/use-capabilities";
import { payPeriodFor, defaultAnchorDate, type PaySchedule } from "@/lib/pay-period";

type Range = "period" | "lastPeriod" | "month" | "last" | "year" | "all";

function rangeFor(r: Range, schedule: PaySchedule, anchorDate: string | null): { start: number; end: number } {
  const now = new Date();
  const farEnd = Date.now() + 86_400_000;
  if (r === "period") return payPeriodFor(schedule, anchorDate, now);
  if (r === "lastPeriod") return payPeriodFor(schedule, anchorDate, now, -1);
  if (r === "all") return { start: 1, end: farEnd };
  if (r === "year") return { start: new Date(now.getFullYear(), 0, 1).getTime(), end: farEnd };
  if (r === "last") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      end: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  };
}

function payLabel(payType: string | null, rateCents: number | null): string {
  if (!payType || rateCents == null) return "-";
  return payType === "hourly" ? `${money(rateCents)}/hr` : `${money(rateCents)}/yr`;
}

export default function PayrollPage() {
  const [range, setRange] = React.useState<Range>("period");
  const [payTarget, setPayTarget] = React.useState<PayTarget | undefined>(undefined);
  const [payOpen, setPayOpen] = React.useState(false);
  const [posting, setPosting] = React.useState(false);

  const { can } = useCapabilities();
  const sched = useQuery(api.payroll.getSchedule, {});
  const setSchedule = useMutation(api.payroll.setSchedule);
  const schedule: PaySchedule = sched?.schedule ?? "monthly";
  const anchorDate = sched?.anchorDate ?? null;

  const { start, end } = rangeFor(range, schedule, anchorDate);
  const data = useQuery(api.payroll.summary, { start, end });
  const postToExpenses = useMutation(api.payroll.postToExpenses);

  const loading = data === undefined;
  // Only a finished pay period or month can be posted: hours are still being
  // worked in the current one, and a year or all time overlaps every period.
  const postable = (range === "lastPeriod" || range === "last") && end <= Date.now();
  const periodLabel =
    range === "period" || range === "lastPeriod"
      ? payPeriodFor(schedule, anchorDate, new Date(), range === "lastPeriod" ? -1 : 0).label
      : null;

  async function changeSchedule(next: PaySchedule) {
    try {
      await setSchedule({
        schedule: next,
        // First switch to biweekly starts the period on the most recent Monday.
        ...(next === "biweekly" && !anchorDate ? { anchorDate: defaultAnchorDate(new Date()) } : {}),
      });
      toast.success(next === "biweekly" ? "Pay schedule set to every two weeks." : "Pay schedule set to monthly.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the pay schedule.");
    }
  }

  function editPay(row: { memberId: Id<"members">; name: string; payType: string | null; payRateCents: number | null }) {
    setPayTarget({
      memberId: row.memberId,
      name: row.name,
      payType: (row.payType as "hourly" | "salary" | null) ?? null,
      payRateCents: row.payRateCents,
    });
    setPayOpen(true);
  }

  async function doPost() {
    setPosting(true);
    try {
      const res = await postToExpenses({ start, end });
      const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(", ");
      const notes: string[] = [];
      if (res.skipped > 0) {
        notes.push(`${res.skipped} ${res.skipped === 1 ? "teammate was" : "teammates were"} already posted for this period with nothing new.`);
      }
      if (res.blocked.length > 0) {
        notes.push(`Not posted yet: ${names(res.blocked)} (a clock is still open or needs a clock-out time; fix it in the timesheet below, then post again).`);
      }
      if (res.overlapping.length > 0) {
        notes.push(`Not posted: ${names(res.overlapping)} (already posted for a period that overlaps this one).`);
      }
      if (res.overPosted.length > 0) {
        notes.push(`Already posted more than is now owed: ${res.overPosted.map((o) => `${o.name} (${money(o.overCents)})`).join(", ")}. Fix that expense by hand.`);
      }
      const tail = notes.length > 0 ? ` ${notes.join(" ")}` : "";
      const rows = res.created + res.adjusted;
      if (rows === 0) {
        if (res.blocked.length + res.overlapping.length + res.overPosted.length > 0) toast.warning(`Nothing posted.${tail}`);
        else toast.info(res.skipped > 0 ? `This period is already posted.${tail}` : "Nothing to post for this period.");
      } else {
        const parts = [
          res.created > 0 ? `${res.created} payroll ${res.created === 1 ? "entry" : "entries"}` : null,
          res.adjusted > 0 ? `${res.adjusted} ${res.adjusted === 1 ? "correction" : "corrections"} for hours added since the last post` : null,
        ].filter(Boolean);
        toast.success(`Posted ${parts.join(" and ")} (${money(res.totalCents)}) to Expenses.${tail}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post to expenses.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Finance"
        title="Payroll"
        description="Staff hours from the time clock, multiplied by each teammate's rate. Post a period's labor cost straight into your P&L."
        actions={
          <Button
            onClick={doPost}
            disabled={posting || !postable || !data || data.rows.length === 0}
            title={postable ? undefined : "Pick Last pay period or Last month to post a finished period."}
          >
            <ArrowRightLeft className="size-4" />
            {posting ? "Posting…" : "Post to expenses"}
          </Button>
        }
      />

      {/* Lived inside the Post button above (a whole panel in a button). */}
      <PayoutsPanel />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-48">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger aria-label="Pay period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="period">This pay period</SelectItem>
              <SelectItem value="lastPeriod">Last pay period</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="last">Last month</SelectItem>
              <SelectItem value="year">This year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {periodLabel && (
          <span className="font-meta text-xs uppercase tracking-wide text-steel/80">{periodLabel}</span>
        )}
        {can("schedule.manage") && sched !== undefined && (
          <div className="ml-auto w-full sm:w-56">
            <Select value={schedule} onValueChange={(v) => changeSchedule(v as PaySchedule)}>
              <SelectTrigger aria-label="Pay schedule"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Paid monthly</SelectItem>
                <SelectItem value="biweekly">Paid every two weeks</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Payroll" value={data ? <CountUp to={data.totalPayCents} format={(n) => money(n, { compact: true })} /> : "-"} icon={Wallet} accent hint="this period" />
        <StatTile label="Hours" value={data ? data.totalHours.toFixed(1) : "-"} icon={Clock} hint="clocked" />
        <StatTile label="On payroll" value={data ? <CountUp to={data.rows.length} /> : "-"} icon={Users} hint="staff" />
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Staff</TH>
            <TH>Rate</TH>
            <TH className="text-right">Hours</TH>
            <TH className="text-right">Pay</TH>
            <TH className="w-10" />
          </TR>
        </THead>
        <TBody>
          {loading ? (
            <TR><TD colSpan={5} className="py-8 text-center text-steel/70">Loading…</TD></TR>
          ) : data.rows.length === 0 ? (
            <TR><TD colSpan={5} className="py-8 text-center text-steel/70">No staff on payroll yet. Set a teammate’s pay to start tracking labor cost.</TD></TR>
          ) : (
            data.rows.map((r) => (
              <TR key={r.memberId}>
                <TD>
                  <EntityLink type="member" id={r.memberId} className="text-bone hover:text-gold hover:underline">
                    {r.name}
                  </EntityLink>
                  <span className="ml-2 text-xs capitalize text-steel/70">{r.role.replace(/_/g, " ")}</span>
                  {r.openCount > 0 && <span className="ml-2 rounded-full border border-gold/40 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-gold">on the clock</span>}
                  {r.needsClockOutCount > 0 && <span className="ml-2 rounded-full border border-gold/40 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-gold">needs a clock-out time</span>}
                </TD>
                <TD className="font-meta text-steel">{payLabel(r.payType, r.payRateCents)}</TD>
                <TD className="text-right font-meta text-steel">{r.hours.toFixed(1)}h</TD>
                <TD className="text-right font-meta text-bone">{money(r.payCents)}</TD>
                <TD>
                  <IconButton variant="ghost" size="icon" label="Set the pay rate" onClick={() => editPay(r)}>
                    <Pencil className="size-4" />
                  </IconButton>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {data && data.needsClockOutCount > 0 && (
        <p role="status" className="text-xs text-gold">
          {data.needsClockOutCount === 1 ? "1 entry is" : `${data.needsClockOutCount} entries are`} still open after 12 hours and left out of these totals until a clock-out time is set.
        </p>
      )}

      <TimesheetPanel
        start={start}
        end={end}
        canEdit={can("invoices.send")}
        members={(data?.rows ?? []).filter((r) => !r.isYou).map((r) => ({ memberId: r.memberId, name: r.name }))}
      />

      <SetPayDialog target={payTarget} open={payOpen} onOpenChange={(o) => { setPayOpen(o); if (!o) setPayTarget(undefined); }} />
    </div>
  );
}
