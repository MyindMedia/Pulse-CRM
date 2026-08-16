"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Plus, Trash2, Save, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { Org, Testimonial } from "./types";

/** Curated client testimonials shown on the public /book page. Proof-of-work
 *  is the difference between a booking page that sells time and one that just
 *  quotes a price - this is where the studio puts real words behind it. */
export function TestimonialsPanel({ org }: { org: Org }) {
  const setTestimonials = useMutation(api.orgs.setTestimonials);

  const [rows, setRows] = React.useState<Testimonial[]>(org.testimonials ?? []);
  const [prevKey, setPrevKey] = React.useState(JSON.stringify(org.testimonials));
  const nextKey = JSON.stringify(org.testimonials);
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    setRows(org.testimonials ?? []);
  }
  const [saving, setSaving] = React.useState(false);

  function add() {
    setRows((prev) => [...prev, { author: "", role: "", quote: "", rating: 5 }]);
  }
  function update(i: number, patch: Partial<Testimonial>) {
    setRows((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function removeAt(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const clean = rows.filter((t) => t.author.trim() && t.quote.trim());
      await setTestimonials({ testimonials: clean });
      toast.success("Testimonials saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client testimonials</CardTitle>
        <CardDescription>
          Short quotes from happy clients, shown as social proof on your public
          booking page. A page selling premium studio time converts far better
          with real words behind it than on price alone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
            No testimonials yet. Add one below.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((t, i) => (
              <li
                key={i}
                className="space-y-3 rounded-md border border-graphite/50 bg-coal-2 p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label="Author">
                    <Input
                      type="text"
                      placeholder="Jordan Reyes"
                      value={t.author}
                      onChange={(e) => update(i, { author: e.target.value })}
                    />
                  </Field>
                  <Field label="Role / project" hint="optional">
                    <Input
                      type="text"
                      placeholder="Independent artist"
                      value={t.role ?? ""}
                      onChange={(e) => update(i, { role: e.target.value })}
                    />
                  </Field>
                  <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                    <StarRating
                      value={t.rating ?? 5}
                      onChange={(r) => update(i, { rating: r })}
                    />
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeAt(i)}
                      label="Remove testimonial"
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
                <Field label="Quote">
                  <Textarea
                    placeholder="They dialed in a tone I'd been chasing for years. Best room in the city."
                    value={t.quote}
                    onChange={(e) => update(i, { quote: e.target.value })}
                    rows={2}
                  />
                </Field>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="size-3.5" />
            Add testimonial
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save testimonials"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className="p-0.5"
        >
          <Star
            className={cn(
              "size-4 transition-colors",
              n <= value ? "fill-gold text-gold" : "text-steel/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}
