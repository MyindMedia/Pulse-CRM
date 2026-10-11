"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OpsActionSheet } from "@/components/ai/ops-action-sheet";
import { errorMessage } from "@/lib/errors";
import { Chassis, ChassisTitle, EmptyWell } from "./parts";

const DAY = 86_400_000;

/* Pulse AI, ops manager (kit 6.2): the top of the proposed-action queue. Pulse
 * suggests, never commands: the first suggestion has Review (opens the full
 * action to read, edit and approve) and Later (snooze a day); the next two
 * open the same sheet. Approving still happens in the sheet, never in one
 * click from here. */
export function OpsManager() {
  const queue = useQuery(api.opsActions.list, { limit: 3 });
  const snooze = useMutation(api.opsActions.snooze);
  const [open, setOpen] = React.useState<Doc<"opsActions"> | null>(null);

  async function later(a: Doc<"opsActions">) {
    try {
      await snooze({ id: a._id, until: Date.now() + DAY });
      toast.success("Snoozed until tomorrow.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not snooze."));
    }
  }

  const items = (queue ?? []).slice(0, 3);
  return (
    <Chassis>
      <ChassisTitle kicker={<Badge tone="solid">Pulse AI</Badge>} title="Ops manager" bar={false} />
      {queue === undefined ? (
        <div className="mt-3 flex-1" aria-busy />
      ) : items.length === 0 ? (
        <div className="mt-3 flex flex-1">
          <EmptyWell>All clear. Pulse checks the studio daily and suggests what needs doing here.</EmptyWell>
        </div>
      ) : (
        <div className="pl-well mt-3 flex-1 space-y-3.5 p-3.5">
          {items.map((a, i) => (
            <div key={a._id} className="font-sans text-[13px] leading-[19px] text-mist">
              <button
                type="button"
                onClick={() => setOpen(a)}
                className={`text-left hover:text-bone ${i === 0 ? "line-clamp-3" : "line-clamp-2"}`}
              >
                <span className="font-semibold text-bone">{a.title}.</span>
                {a.rationale ? <span> {a.rationale}</span> : null}
              </button>
              {i === 0 && (
                <div className="mt-2.5 flex items-center gap-2">
                  <Button size="sm" onClick={() => setOpen(a)}>
                    Review
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void later(a)}>
                    Later
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <OpsActionSheet action={open} onClose={() => setOpen(null)} />
    </Chassis>
  );
}
