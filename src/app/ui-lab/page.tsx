import { notFound } from "next/navigation";
import { CalendarPlus, DollarSign, Clock, Wallet } from "lucide-react";
import { IS_STAGING } from "@/lib/deploy-env";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Progress } from "@/components/ui/progress";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Input } from "@/components/ui/field";
import { HardwareSpecimens } from "./hardware-specimens";

/* Staging-only gallery of the app's real components wearing the hardware
   UI (pulse-ui-kit). It needs no sign-in, so the look can be checked and
   compared with the kit's mockups before it reaches a real screen. Production
   returns 404. */
export const metadata = { title: "UI lab", robots: { index: false, follow: false } };
// Rendered per request so production answers notFound() with a real 404
// status; prerendered, Netlify served the not-found page as a 200.
export const dynamic = "force-dynamic";

const SESSIONS = [
  { client: "Nova Vega", room: "Studio A", time: "10:00 to 14:00", engineer: "J. Ortiz", status: "Paid", tone: "positive", amount: "$600.00" },
  { client: "Kei Marlow", room: "Studio B", time: "15:00 to 19:00", engineer: "D. Reyes", status: "Deposit", tone: "gold", amount: "$450.00" },
  { client: "Lot 9 Records", room: "Mix Suite", time: "20:00 to 02:00", engineer: "J. Ortiz", status: "Overdue", tone: "critical", amount: "$1,200.00" },
] as const;

export default function UiLabPage() {
  if (!IS_STAGING) notFound();
  return (
    <div className="pulse-hw min-h-dvh bg-ink px-6 py-8 text-bone">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <HardwareSpecimens />
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">UI lab</CardTitle>
            <CardDescription>
              The app&apos;s real Card, Button, Badge, StatTile, Progress, Table and Input in the hardware UI.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button>New booking</Button>
            <Button variant="secondary">Add notes</Button>
            <Button variant="outline">Open calendar</Button>
            <Button variant="ghost">Later</Button>
            <Button variant="danger">Cancel session</Button>
            <Button size="sm">Extend session</Button>
            <Button size="icon" variant="secondary" aria-label="New booking">
              <CalendarPlus />
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-4">
          <StatTile label="Revenue" value="$48,250" icon={DollarSign} delta={12.4} accent />
          <StatTile label="Booked hours" value="312" icon={Clock} delta={4.1} />
          <StatTile label="Deposits held" value="$5,400" icon={Wallet} delta={9} />
          <StatTile label="Outstanding" value="$6,900" icon={Wallet} delta={-8.3} />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Room utilization</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                ["Studio A", 82, "gold"],
                ["Studio B", 64, "info"],
                ["Mix Suite", 47, "positive"],
              ].map(([room, pct, tone]) => (
                <div key={room as string} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span>{room}</span>
                    <span className="font-mono">{pct}%</span>
                  </div>
                  <Progress value={pct as number} tone={tone as "gold" | "info" | "positive"} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Chips and fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="solid">Live now</Badge>
                <Badge tone="positive">Paid</Badge>
                <Badge tone="gold">Deposit</Badge>
                <Badge tone="critical">Overdue</Badge>
                <Badge tone="info">Stripe synced</Badge>
                <Badge>Draft</Badge>
              </div>
              <Input placeholder="Search clients, sessions, invoices" aria-label="Search" />
              <div className="pl-well p-4">
                <p className="text-sm text-ash">A recessed well. Readouts, charts and lists live here.</p>
                <p className="mt-2 font-mono text-3xl text-gold">02:14:37</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="pl-grid">
          <CardHeader>
            <CardTitle>Today&apos;s sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="pl-well overflow-x-auto p-2">
              <Table>
                <THead>
                  <TR>
                    <TH>Client</TH>
                    <TH>Room</TH>
                    <TH>Time</TH>
                    <TH>Engineer</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {SESSIONS.map((s) => (
                    <TR key={s.client}>
                      <TD>{s.client}</TD>
                      <TD>{s.room}</TD>
                      <TD className="font-mono">{s.time}</TD>
                      <TD>{s.engineer}</TD>
                      <TD>
                        <Badge tone={s.tone}>{s.status}</Badge>
                      </TD>
                      <TD className="text-right font-mono">{s.amount}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
