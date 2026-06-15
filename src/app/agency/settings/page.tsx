"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import {
  Building2,
  CreditCard,
  Hourglass,
  Lock,
  Palette,
  Tag,
  Users,
} from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgencySettingsPage() {
  const summary = useQuery(api.agencySettings.summary);
  const update = useMutation(api.agencySettings.updateProfile);

  const [name, setName] = React.useState("");
  const [supportEmail, setSupportEmail] = React.useState("");
  const [appName, setAppName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [seeded, setSeeded] = React.useState(false);

  React.useEffect(() => {
    if (summary && !seeded) {
      setName(summary.name ?? "");
      setSupportEmail(summary.supportEmail ?? "");
      setAppName(summary.appName ?? "");
      setSeeded(true);
    }
  }, [summary, seeded]);

  async function save() {
    setSaving(true);
    try {
      await update({ name, supportEmail, appName });
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (summary === undefined) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const c = summary?.counts;

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Agency"
        title="Settings"
        description="Your agency identity, billing health across studios, and shortcuts to everything you manage."
      />

      {/* Billing health */}
      <Section title="Billing health">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Studios" value={c?.studios ?? 0} icon={Building2} />
          <StatTile label="On trial" value={c?.onTrial ?? 0} icon={Hourglass} />
          <StatTile label="Active / paying" value={c?.active ?? 0} icon={CreditCard} accent />
          <StatTile label="Past due / locked" value={c?.pastDue ?? 0} icon={Lock} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Identity */}
        <Section title="Agency profile">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <Field label="Agency name" htmlFor="ag-name">
                <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agency" />
              </Field>
              <Field label="App name" htmlFor="ag-appname" hint="Shown in your studios' nav (white-label).">
                <Input id="ag-appname" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Pulse" />
              </Field>
              <Field label="Support email" htmlFor="ag-support" hint="Billing & support contact your studios see.">
                <Input
                  id="ag-support"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  placeholder="support@youragency.com"
                  type="email"
                />
              </Field>
              <div className="flex items-center justify-between">
                <Badge tone="gold" className="capitalize">{summary?.plan} plan</Badge>
                <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* Manage shortcuts */}
        <Section title="Manage">
          <Card>
            <CardContent className="divide-y divide-graphite/40 pt-1">
              <ManageRow href="/agency/plans" icon={Tag} title="Plans & pricing"
                desc={`${c?.activePlans ?? 0} active · default: ${c?.defaultPlanName ?? "none set"}`} />
              <ManageRow href="/agency/branding" icon={Palette} title="Branding"
                desc="Logo, accent color, custom domain" />
              <ManageRow href="/agency/staff" icon={Users} title="Staff & roles"
                desc={`${c?.staff ?? 0} member${(c?.staff ?? 0) === 1 ? "" : "s"}`} />
              <ManageRow href="/agency" icon={Building2} title="Sub-accounts"
                desc={`${c?.studios ?? 0} studio${(c?.studios ?? 0) === 1 ? "" : "s"}`} />
            </CardContent>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function ManageRow({
  href, icon: Icon, title, desc,
}: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 py-3 transition-colors hover:bg-coal-2/40 -mx-2 px-2 rounded-md">
      <span className="grid size-9 place-items-center rounded-md bg-coal-2 text-gold">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-bone">{title}</p>
        <p className="truncate text-xs text-steel">{desc}</p>
      </div>
      <span className="text-steel/50">›</span>
    </Link>
  );
}
