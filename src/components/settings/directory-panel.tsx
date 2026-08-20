"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Compass, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/toggle";

/* Directory listing controls.

   Off by default and stated plainly: this puts the studio on a public page.
   Nobody should discover they are listed. */

export function DirectoryPanel() {
  const s = useQuery(api.directory.mySettings);
  const update = useMutation(api.directory.updateSettings);
  const [draft, setDraft] = React.useState<{ blurb: string; city: string; region: string; tags: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (s && draft === null) {
      setDraft({ blurb: s.blurb, city: s.city, region: s.region, tags: s.tags.join(", ") });
    }
  }, [s, draft]);

  if (!s || !draft) return null;

  async function save(patch: Parameters<typeof update>[0], ok: string) {
    setBusy(true);
    try {
      await update(patch);
      toast.success(ok);
    } catch {
      toast.error("Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
              <Compass className="size-4" />
            </span>
            <div>
              <p className="font-grotesk text-sm font-semibold text-bone">
                List on Find a Studio
              </p>
              <p className="text-xs text-steel">
                Put this studio on the public directory at /studios. Artists see your rooms,
                your rates and your next open day, and book on your own page. Pulse takes
                nothing from what it sends you.
              </p>
            </div>
          </div>
          <Switch
            checked={s.listed}
            disabled={busy}
            onCheckedChange={(v) =>
              save({ listed: v }, v ? "You are on the directory." : "Removed from the directory.")
            }
            aria-label="List this studio on the public directory"
          />
        </div>

        {s.listed && !s.preview && (
          <p className="flex items-start gap-2 rounded-md border border-caution/30 bg-caution/10 px-3 py-2.5 text-xs text-caution">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            You will not appear yet. A listing needs at least one bookable room with a rate.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              One line about the room
            </span>
            <input
              value={draft.blurb}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, blurb: e.target.value })}
              placeholder="Neve 8068, live room that fits a drum kit and a string quartet."
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">City</span>
            <input
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              State or region
            </span>
            <input
              value={draft.region}
              onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              What you are known for
            </span>
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="SSL, vocal booth, drum room, mixing"
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
            <span className="mt-1 block text-[0.65rem] text-steel/60">
              Comma separated. Up to eight.
            </span>
          </label>
        </div>

        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            save(
              {
                blurb: draft.blurb,
                city: draft.city,
                region: draft.region,
                tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
              },
              "Listing updated.",
            )
          }
        >
          Save listing
        </Button>
      </CardContent>
    </Card>
  );
}
