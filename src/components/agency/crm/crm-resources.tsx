"use client";

import * as React from "react";
import { Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TOUCH } from "./crm-ui";
import { GROUP_TITLES, RESOURCES, type ResourceGroup } from "./resource-config";
import { ResourcePanel } from "./resource-panel";

/* Campaigns, Automations, Forms, Calls, More and Settings: each a list of
   config-driven resources (resource-config.ts) with a sub-navigation, a vertical
   list on desktop and a Select on phones. Only the selected resource is mounted,
   so an open tab reads one list or object (plus one record when a row is open):
   eval P-02. The choice lives in component state only. */

export function CrmResources({ group }: { group: ResourceGroup }) {
  const resources = RESOURCES[group] ?? [];
  const [selected, setSelected] = React.useState<string>(resources[0]?.key ?? "");
  const current = resources.find((r) => r.key === selected) ?? resources[0];
  const navId = `crm-${group}-nav`;
  if (!current) return null;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      {resources.length > 1 && (
        <>
          <div className="space-y-1 lg:hidden">
            <Label htmlFor={navId}>{GROUP_TITLES[group]} section</Label>
            <Select value={current.key} onValueChange={setSelected}>
              <SelectTrigger id={navId} className={TOUCH}><SelectValue /></SelectTrigger>
              <SelectContent>
                {resources.map((r) => <SelectItem key={r.key} value={r.key}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <nav aria-label={`${GROUP_TITLES[group]} sections`} className="hidden lg:block">
            <ul className="space-y-0.5">
              {resources.map((r) => {
                const on = r.key === current.key;
                return (
                  <li key={r.key}>
                    <button
                      type="button" onClick={() => setSelected(r.key)} aria-current={on ? "page" : undefined}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold/40",
                        on ? "bg-coal-2 font-semibold text-bone" : "text-steel hover:bg-coal-2/60 hover:text-bone",
                      )}
                    >
                      {r.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}
      <div className={cn("min-w-0", resources.length <= 1 && "lg:col-span-2")}>
        <ResourcePanel key={current.key} def={current} />
      </div>
    </div>
  );
}
