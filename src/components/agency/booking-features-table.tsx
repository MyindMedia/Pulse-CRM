"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CheckDone01 } from "@untitledui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/toggle";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  BOOKING_FEATURE_COPY,
  BOOKING_FEATURE_KEYS,
  type BookingFeatureKey,
} from "@convex/lib/bookingFeatureCopy";

type Features = Record<BookingFeatureKey, boolean>;
type Draft = Record<string, Partial<Features>>;

/** Agency console: the four booking switches for every studio this agency
 *  member may manage (staff see only their scoped studios; the server filters
 *  and re-checks scope on write). Edits are a draft until "Apply to selected
 *  studios". Editing a cell selects its row; the checkbox in a column header
 *  sets that switch for every studio. */
export function BookingFeaturesTable() {
  const rows = useQuery(api.bookingFeatures.agencyListBookingFeatures);
  const apply = useMutation(api.bookingFeatures.agencySetBookingFeatures);
  const [draft, setDraft] = React.useState<Draft>({});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  if (rows === undefined) return <SkeletonRows rows={4} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckDone01}
        title="No studios to manage"
        description="Studios you can manage show up here with their booking switches."
      />
    );
  }

  const value = (orgId: string, server: Features): Features => ({ ...server, ...draft[orgId] });
  const isDirty = (orgId: string, server: Features) =>
    BOOKING_FEATURE_KEYS.some((k) => value(orgId, server)[k] !== server[k]);

  function select(orgIds: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of orgIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function setCell(orgId: string, key: BookingFeatureKey, on: boolean) {
    setDraft((d) => ({ ...d, [orgId]: { ...d[orgId], [key]: on } }));
    select([orgId], true);
  }

  function setColumn(key: BookingFeatureKey, on: boolean) {
    setDraft((d) => {
      const next = { ...d };
      for (const r of rows!) next[r.orgId] = { ...next[r.orgId], [key]: on };
      return next;
    });
    select(rows!.map((r) => r.orgId), true);
  }

  async function applySelected() {
    // One call per distinct set of switches, so a column set the same way
    // across many studios lands in a single atomic write.
    const groups = new Map<string, { features: Features; orgIds: string[] }>();
    for (const r of rows!) {
      if (!selected.has(r.orgId)) continue;
      const f = value(r.orgId, r.features);
      const sig = BOOKING_FEATURE_KEYS.map((k) => (f[k] ? 1 : 0)).join("");
      const g = groups.get(sig) ?? { features: f, orgIds: [] };
      g.orgIds.push(r.orgId);
      groups.set(sig, g);
    }
    setSaving(true);
    try {
      let changed = 0;
      for (const g of groups.values()) {
        const res = await apply({ orgIds: g.orgIds, features: g.features });
        changed += res.changed;
      }
      const applied = [...selected];
      setDraft((d) => {
        const next = { ...d };
        for (const id of applied) delete next[id];
        return next;
      });
      setSelected(new Set());
      toast.success(
        changed === 0
          ? "Nothing to change on the selected studios."
          : `Updated ${applied.length} studio${applied.length === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update booking features.");
    } finally {
      setSaving(false);
    }
  }

  const allSelected = rows.every((r) => selected.has(r.orgId));
  const someSelected = rows.some((r) => selected.has(r.orgId));
  const dirtyCount = rows.filter((r) => isDirty(r.orgId, r.features)).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-steel">
        Turn booking features on for one studio or many. Pick the studios, set the switches,
        then apply. Every plan gets these.
      </p>
      <Table>
        <THead>
          <TR>
            <TH className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(on) => select(rows.map((r) => r.orgId), on === true)}
                aria-label="Select all studios"
              />
            </TH>
            <TH>Studio</TH>
            {BOOKING_FEATURE_KEYS.map((key) => {
              const copy = BOOKING_FEATURE_COPY[key];
              const onCount = rows.filter((r) => value(r.orgId, r.features)[key]).length;
              const all = onCount === rows.length;
              return (
                <TH key={key} className="whitespace-nowrap text-center" title={copy.blurb}>
                  <div className="flex flex-col items-center gap-1.5">
                    <span>{copy.short}</span>
                    <Checkbox
                      checked={all ? true : onCount > 0 ? "indeterminate" : false}
                      onCheckedChange={(on) => setColumn(key, on === true)}
                      aria-label={`${copy.label}: set for all studios`}
                    />
                  </div>
                </TH>
              );
            })}
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const f = value(r.orgId, r.features);
            const dirty = isDirty(r.orgId, r.features);
            return (
              <TR key={r.orgId}>
                <TD>
                  <Checkbox
                    checked={selected.has(r.orgId)}
                    onCheckedChange={(on) => select([r.orgId], on === true)}
                    aria-label={`Select ${r.name}`}
                  />
                </TD>
                <TD>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-bone">{r.name}</span>
                    {dirty && <Badge tone="caution">Not applied</Badge>}
                  </div>
                  <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                    /{r.slug}
                  </p>
                </TD>
                {BOOKING_FEATURE_KEYS.map((key) => (
                  <TD key={key} className="text-center">
                    <Switch
                      checked={f[key]}
                      onCheckedChange={(on) => setCell(r.orgId, key, on)}
                      aria-label={`${BOOKING_FEATURE_COPY[key].label} for ${r.name}`}
                    />
                  </TD>
                ))}
              </TR>
            );
          })}
        </TBody>
      </Table>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-steel/70">
          {selected.size} selected{dirtyCount > 0 ? ` · ${dirtyCount} with changes` : ""}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving || (dirtyCount === 0 && selected.size === 0)}
          onClick={() => {
            setDraft({});
            setSelected(new Set());
          }}
        >
          Reset
        </Button>
        <Button type="button" size="sm" disabled={saving || selected.size === 0} onClick={applySelected}>
          <CheckDone01 className="size-4" aria-hidden />
          {saving ? "Applying…" : "Apply to selected studios"}
        </Button>
      </div>
    </div>
  );
}
