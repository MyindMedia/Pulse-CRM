"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AppWindow, Plus, RefreshCw, CalendarClock, Infinity as InfinityIcon, Layers } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { money } from "@/lib/format";
import { SOFTWARE_CATEGORIES } from "@/components/software/constants";
import { SoftwareTable, type SoftwareRow } from "@/components/software/software-table";
import { SoftwareDialog, type EditableSoftware } from "@/components/software/software-dialog";

const ALL = "all";

export default function SoftwarePage() {
  const [category, setCategory] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<EditableSoftware | undefined>(undefined);
  const [editOpen, setEditOpen] = React.useState(false);

  const summary = useQuery(api.software.summary);
  const items = useQuery(api.software.list, {
    category: category === ALL ? undefined : category,
    status: status === ALL ? undefined : status,
  }) as SoftwareRow[] | undefined;

  const loading = items === undefined;
  const filtering = category !== ALL || status !== ALL;

  function handleEdit(s: SoftwareRow) {
    setEditItem({
      _id: s._id, name: s.name, vendor: s.vendor, category: s.category,
      licenseType: s.licenseType, seats: s.seats, costCents: s.costCents,
      billingInterval: s.billingInterval, renewalDate: s.renewalDate,
      licenseKey: s.licenseKey, seatHolder: s.seatHolder, status: s.status, notes: s.notes,
    });
    setEditOpen(true);
  }

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Assets"
        title="Software & Licenses"
        description="Every DAW, plugin, sample library and subscription the studio runs - cost, seats, renewals and license keys in one place."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add software
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Licenses" value={summary ? String(summary.count) : "—"} icon={AppWindow} accent hint={summary ? `${summary.subscriptions} subscriptions` : ""} />
        <StatTile label="Recurring / yr" value={summary ? money(summary.annualRecurring, { compact: true }) : "—"} icon={RefreshCw} hint={summary ? `${money(summary.monthlyRecurring)}/mo` : ""} />
        <StatTile label="Perpetual value" value={summary ? money(summary.perpetualValue, { compact: true }) : "—"} icon={InfinityIcon} hint="one-time licenses" />
        <StatTile label="Renewals soon" value={summary ? String(summary.upcomingRenewals) : "—"} icon={CalendarClock} hint="next 60 days" />
        <StatTile label="Expired" value={summary ? String(summary.expired) : "—"} icon={Layers} hint="need attention" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-48">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Filter by category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {SOFTWARE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="unused">Unused</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={() => { setCategory(ALL); setStatus(ALL); }}>Clear filters</Button>
        )}
      </div>

      <SoftwareTable items={items ?? []} loading={loading} filtering={filtering} onEdit={handleEdit} />

      <SoftwareDialog open={addOpen} onOpenChange={setAddOpen} />
      <SoftwareDialog item={editItem} open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditItem(undefined); }} />
    </div>
  );
}
