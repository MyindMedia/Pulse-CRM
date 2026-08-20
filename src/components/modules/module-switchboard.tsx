"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Lock, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* The module switchboard, grouped into the same fourteen areas as the feature
   catalog so both read as one document.

   Two callers, one difference: pass an orgId and it manages that sub-account
   through agency.setFeatures; omit it and a studio owner manages their own
   workspace through modules.setModule. Everything else - grouping, tier locks,
   core protection - is identical, because it comes from the server's board
   query rather than from either caller. */

export function ModuleSwitchboard({ orgId }: { orgId?: string }) {
  const board = useQuery(api.modules.board, orgId ? { orgId } : {});
  const setFeatures = useMutation(api.agency.setFeatures);
  const setModule = useMutation(api.modules.setModule);
  const [pending, setPending] = React.useState<string | null>(null);

  const disabledKeys = React.useMemo(() => {
    if (!board) return new Set<string>();
    return new Set(
      board.areas
        .flatMap((a) => a.modules)
        .filter((m) => m.owned && !m.enabled)
        .map((m) => m.key),
    );
  }, [board]);

  if (!board) return <p className="text-sm text-steel">Loading modules…</p>;

  async function toggle(key: string, label: string, enable: boolean) {
    setPending(key);
    try {
      if (orgId) {
        // The agency path writes the whole list, so rebuild it from what the
        // server just told us is off. Two admins on the same studio then
        // cannot clobber each other with a snapshot from page load.
        const next = new Set(disabledKeys);
        if (enable) next.delete(key);
        else next.add(key);
        await setFeatures({ orgId, disabledFeatures: [...next] });
      } else {
        await setModule({ key, enabled: enable });
      }
      toast.success(`${label} ${enable ? "switched on" : "switched off"}.`);
    } catch (e) {
      const data = (e as { data?: { message?: string } })?.data;
      toast.error(
        data?.message ??
          (e instanceof Error ? e.message : "Could not update that module."),
      );
    } finally {
      setPending(null);
    }
  }

  const { counts } = board;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-graphite/50 bg-coal/40 px-3.5 py-2.5">
        <Stat n={counts.enabled} label="on" />
        <Stat n={counts.offByChoice} label="switched off" />
        <Stat n={counts.lockedByTier} label="not on this plan" />
        <span className="ml-auto text-xs text-steel/70">
          {board.tierLabel} · {board.tierPrice}/mo
        </span>
      </div>

      {board.areas.map((area) => (
        <section key={area.area}>
          <header className="flex items-baseline justify-between gap-3 border-b border-graphite/50 pb-1.5">
            <h3 className="font-grotesk text-sm font-semibold text-bone">{area.label}</h3>
            <span className="font-meta text-[0.625rem] uppercase tracking-[0.08em] text-steel/60">
              {area.modules.filter((m) => m.enabled).length}/
              {area.modules.length + area.alwaysOn.length}
            </span>
          </header>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {area.modules.map((m) => {
              const locked = !m.switchable;
              return (
                <label
                  key={m.key}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border p-3 transition-colors",
                    locked
                      ? "border-graphite/40 bg-coal/20"
                      : "border-graphite/50 bg-coal-2 hover:border-graphite/70",
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-sm font-medium", m.enabled ? "text-bone" : "text-steel")}>
                        {m.label}
                      </span>
                      {m.core && <Badge tone="neutral">Core</Badge>}
                      {m.lockedReason === "tier" && m.tierLabel && (
                        <Badge tone="gold">{m.tierLabel}</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-steel/70">
                      {m.lockedReason === "core"
                        ? "Part of the core product. Cannot be switched off."
                        : m.lockedReason === "tier"
                          ? `${m.tierLabel} (${m.tierPrice}/mo) unlocks this.`
                          : m.blurb}
                    </span>
                  </span>
                  {locked ? (
                    <Lock className="size-4 shrink-0 text-steel/40" aria-hidden />
                  ) : (
                    <Switch
                      checked={m.enabled}
                      onCheckedChange={(v) => toggle(m.key, m.label, v)}
                      disabled={pending === m.key}
                      aria-label={`Toggle ${m.label}`}
                    />
                  )}
                </label>
              );
            })}

            {area.alwaysOn.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border border-graphite/40 bg-coal/20 p-3"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-steel">{a.label}</span>
                    {a.kind === "always" ? (
                      <Badge tone="neutral">Always on</Badge>
                    ) : (
                      a.tierLabel && <Badge tone="gold">{a.tierLabel}</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-steel/70">{a.blurb}</span>
                </span>
                <ShieldCheck className="size-4 shrink-0 text-steel/40" aria-hidden />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <b className="font-mono text-sm tabular-nums text-bone">{n}</b>
      <span className="text-xs text-steel/70">{label}</span>
    </span>
  );
}
