"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, Info } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACCENT_SWATCHES,
  PLAN_TIERS,
  type Org,
  type OrgPlan,
} from "@/components/settings/types";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** Workspace identity panel — name, tagline, plan, accent color. */
export function WorkspacePanel({ org }: { org: Org }) {
  const updateOrg = useMutation(api.orgs.update);
  const [name, setName] = React.useState(org.name);
  const [tagline, setTagline] = React.useState(org.tagline);
  const [plan, setPlan] = React.useState<OrgPlan>(org.plan);
  const [accent, setAccent] = React.useState(org.accentColor);
  const [submitting, setSubmitting] = React.useState(false);

  // Re-seed local state if the org record changes underneath us.
  React.useEffect(() => {
    setName(org.name);
    setTagline(org.tagline);
    setPlan(org.plan);
    setAccent(org.accentColor);
  }, [org.name, org.tagline, org.plan, org.accentColor]);

  const accentValid = HEX_RE.test(accent.trim());
  const normalizedAccent = accent.trim().startsWith("#")
    ? accent.trim()
    : `#${accent.trim()}`;

  const dirty =
    name.trim() !== org.name ||
    tagline.trim() !== org.tagline ||
    plan !== org.plan ||
    (accentValid && normalizedAccent.toLowerCase() !== org.accentColor.toLowerCase());

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("The workspace needs a name.");
      return;
    }
    if (!accentValid) {
      toast.error("Accent color must be a 6-digit hex value.");
      return;
    }
    setSubmitting(true);
    try {
      await updateOrg({
        name: name.trim(),
        tagline: tagline.trim(),
        plan,
        accentColor: normalizedAccent,
      });
      toast.success("Workspace settings saved.");
    } catch {
      toast.error("Could not save settings. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setName(org.name);
    setTagline(org.tagline);
    setPlan(org.plan);
    setAccent(org.accentColor);
  }

  return (
    <form onSubmit={handleSave}>
      <Card>
        <CardHeader>
          <CardTitle>Workspace identity</CardTitle>
          <CardDescription>
            How Pulse names and brands this studio. Changes apply across the whole
            workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Workspace name" htmlFor="ws-name">
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lumen Recording Co."
                required
              />
            </Field>
            <Field
              label="Workspace slug"
              htmlFor="ws-slug"
              hint="Read-only — derived from the name when the workspace was created."
            >
              <Input
                id="ws-slug"
                value={org.slug}
                readOnly
                disabled
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="Tagline"
            htmlFor="ws-tagline"
            hint="A short line shown on shared documents and invoices."
          >
            <Textarea
              id="ws-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Where the record gets made."
              className="min-h-16"
            />
          </Field>

          <Field label="Plan" htmlFor="ws-plan">
            <Select value={plan} onValueChange={(v) => setPlan(v as OrgPlan)}>
              <SelectTrigger id="ws-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TIERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label} — {t.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Accent color"
            hint="Pick a swatch or enter a 6-digit hex value."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {ACCENT_SWATCHES.map((s) => {
                  const active =
                    normalizedAccent.toLowerCase() === s.value.toLowerCase();
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setAccent(s.value)}
                      title={s.label}
                      aria-label={s.label}
                      className={cn(
                        "grid size-8 place-items-center rounded-md border transition-transform",
                        active
                          ? "border-bone scale-105"
                          : "border-hairline-2 hover:scale-105",
                      )}
                      style={{ backgroundColor: s.value }}
                    >
                      {active && <Check className="size-4 text-ink" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-md border border-hairline-2"
                  style={{
                    backgroundColor: accentValid ? normalizedAccent : "transparent",
                  }}
                  aria-hidden
                />
                <Input
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  placeholder="#E0A226"
                  className={cn(
                    "max-w-40 font-mono",
                    !accentValid && accent.trim() !== "" && "border-critical/50",
                  )}
                  aria-label="Accent color hex"
                />
                {!accentValid && accent.trim() !== "" && (
                  <span className="text-[0.6875rem] text-critical">
                    Enter a 6-digit hex.
                  </span>
                )}
              </div>
            </div>
          </Field>

          <div className="flex items-start gap-2 rounded-md border border-hairline bg-coal-2 px-3 py-2.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <p className="text-[0.6875rem] text-ash-dim">
              This workspace is running in demo mode. Settings persist to the
              Convex backend but no real billing or external accounts are touched.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={submitting || !dirty}
          >
            Reset
          </Button>
          <Button type="submit" disabled={submitting || !dirty}>
            <Check className="size-4" />
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
